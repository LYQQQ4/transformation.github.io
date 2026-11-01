#!/bin/bash
set -Eeuo pipefail
umask 077
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

root=/var/backups/transport-order-management
config=/etc/transport-order-management-backup
output=$root/encrypted/automatic
bucket=transformation-backup-bj-20261101
batch=unknown
partial=
receipt_tmp=
upload_log=
retention_list=

fail() {
    printf 'offsite-failed batch=%s reason=%s\n' "$batch" "$1" >&2
    exit 1
}

finish() {
    local status=$?
    trap - EXIT
    [[ -z "$partial" ]] || rm -f -- "$partial"
    [[ -z "$receipt_tmp" ]] || rm -f -- "$receipt_tmp"
    [[ -z "$retention_list" ]] || rm -f -- "$retention_list"
    if ((status != 0)); then
        printf 'offsite-failed batch=%s exit=%s\n' "$batch" "$status" >&2
        if [[ -n "$upload_log" && -f "$upload_log" ]]; then
            printf 'offsite-private-log=%s\n' "$upload_log" >&2
        fi
    fi
    exit "$status"
}
trap finish EXIT

secure_dir() {
    [[ -d "$1" && ! -L "$1" ]] || fail unsafe-directory
    [[ "$(stat -c '%u:%a' -- "$1")" == 0:700 ]] || fail directory-permissions
}

secure_file() {
    [[ -f "$1" && ! -L "$1" && -s "$1" ]] || fail unsafe-or-empty-file
    [[ "$(stat -c '%u:%a' -- "$1")" == 0:600 ]] || fail file-permissions
}

((EUID == 0)) || fail root-required
(($# <= 1)) || fail usage-expects-optional-batch
secure_dir "$root"
secure_dir "$config"
secure_file "$config/age-recipients.txt"
secure_file "$config/ossutilconfig"
[[ -x /usr/local/bin/age && -x /usr/local/bin/ossutil ]] || fail missing-tools

exec 9>/run/lock/transport-order-management-offsite.lock
flock -n 9 || fail another-offsite-run-is-active

if (($# == 1)); then
    batch=$1
else
    shopt -s nullglob
    manifests=("$root"/manifest_????????-??????.sha256)
    ((${#manifests[@]} > 0)) || fail no-backup-manifest
    latest=${manifests[${#manifests[@]}-1]}
    batch=${latest##*/manifest_}
    batch=${batch%.sha256}
fi
[[ "$batch" =~ ^[0-9]{8}-[0-9]{6}$ ]] || fail invalid-batch

manifest=$root/manifest_$batch.sha256
sql=$root/mysql_$batch.sql.gz
uploads=$root/uploads_$batch.tar.gz
for file in "$manifest" "$sql" "$uploads"; do
    secure_file "$file"
done
if (($# == 0)); then
    age_seconds=$(($(date +%s) - $(stat -c %Y -- "$manifest")))
    ((age_seconds >= -60 && age_seconds <= 1800)) || fail latest-backup-is-not-fresh
fi

# Require the manifest to cover exactly the two files that will be archived.
actual=$(sha256sum -- "$sql" "$uploads" | sort)
expected=$(sort -- "$manifest")
[[ "$actual" == "$expected" ]] || fail source-checksum-mismatch

if [[ ! -e "$root/encrypted" && ! -L "$root/encrypted" ]]; then
    mkdir -m 700 -- "$root/encrypted"
fi
secure_dir "$root/encrypted"
if [[ ! -e "$output" && ! -L "$output" ]]; then
    mkdir -m 700 -- "$output"
fi
secure_dir "$output"

partial=$(mktemp --suffix=.tar.gz.age.part "$output/backup_${batch}_XXXXXXXXXX")
cipher=${partial%.part}
tar -C "$root" -czf - \
    "mysql_$batch.sql.gz" "uploads_$batch.tar.gz" "manifest_$batch.sha256" |
    /usr/local/bin/age -R "$config/age-recipients.txt" > "$partial"
[[ -s "$partial" ]] || fail empty-ciphertext
ln -- "$partial" "$cipher"
rm -- "$partial"
partial=

hash=$(sha256sum -- "$cipher")
hash=${hash%% *}
key=daily/automatic/${cipher##*/}
upload_log=$cipher.upload.log
uploaded=false
for attempt in 1 2 3; do
    printf 'offsite-upload batch=%s attempt=%s\n' "$batch" "$attempt"
    if timeout --signal=TERM --kill-after=10s 240s \
        /usr/local/bin/ossutil api put-object \
        -c "$config/ossutilconfig" --bucket "$bucket" --key "$key" \
        --body "file://$cipher" --forbid-overwrite true \
        --retry-times 0 --connect-timeout 15 --read-timeout 120 \
        > "$upload_log" 2>&1; then
        uploaded=true
        break
    fi
    ((attempt == 3)) || sleep "$((attempt * 5))"
done
[[ "$uploaded" == true ]] || fail upload-not-confirmed-ciphertext-retained

receipt_tmp=$(mktemp "$output/.upload-receipt.XXXXXXXXXX")
printf '%s  %s\n' "$hash" "$key" > "$receipt_tmp"
ln -- "$receipt_tmp" "$cipher.uploaded"
rm -- "$receipt_tmp" "$upload_log"
receipt_tmp=
upload_log=
printf 'offsite-upload-ok batch=%s sha256=%s key=%s\n' "$batch" "$hash" "$key"

# Prune only confirmed uploads in this script's own directory after 14 days.
# Unconfirmed ciphertext, original backups and manually encrypted copies stay.
retention_list=$(mktemp "$output/.retention-list.XXXXXXXXXX")
find "$output" -maxdepth 1 -type f -name '*.uploaded' -mtime +13 -print0 > "$retention_list"
while IFS= read -r -d '' receipt; do
    name=${receipt##*/}
    name=${name%.uploaded}
    [[ "$name" =~ ^backup_[0-9]{8}-[0-9]{6}_[a-zA-Z0-9]{10}\.tar\.gz\.age$ ]] ||
        fail unexpected-retention-filename
    secure_file "$receipt"
    old_cipher=$output/$name
    if [[ -e "$old_cipher" || -L "$old_cipher" ]]; then
        secure_file "$old_cipher"
        read -r saved_hash saved_key extra < "$receipt"
        [[ "$saved_hash" =~ ^[a-f0-9]{64}$ && -z "$extra" &&
            "$saved_key" == "daily/automatic/$name" ]] || fail invalid-upload-receipt
        old_hash=$(sha256sum -- "$old_cipher")
        [[ "${old_hash%% *}" == "$saved_hash" ]] || fail retained-ciphertext-changed
        rm -- "$old_cipher"
    fi
    rm -- "$receipt"
done < "$retention_list"
rm -- "$retention_list"
retention_list=
printf 'offsite-ok %s\n' "$batch"
