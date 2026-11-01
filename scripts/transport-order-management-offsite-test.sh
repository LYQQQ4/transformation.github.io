#!/bin/bash
set -Eeuo pipefail
umask 077

# This harness is destructive only to disposable, tmpfs-backed test fixtures.
[[ -f /.dockerenv && "${RUN_OFFSITE_FIXTURE_TESTS:-}" == 1 ]] || exit 90
for dir in /var/backups /etc/transport-order-management-backup /usr/local/bin /tmp /run/lock; do
    [[ "$(stat -f -c %T -- "$dir")" == tmpfs ]] || exit 91
done

root=/var/backups/transport-order-management
config=/etc/transport-order-management-backup
script=/work/scripts/transport-order-management-offsite.sh
batch=20261101-023938
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

tar -xzf /age-release.tar.gz -C /tmp
install -m 755 /tmp/age/age /usr/local/bin/age-real
install -m 755 /tmp/age/age-keygen /usr/local/bin/age-keygen
printf '%s\n' '#!/bin/bash' \
    '[[ "${MOCK_AGE_FAIL:-0}" != 1 ]] || exit 17' \
    'exec /usr/local/bin/age-real "$@"' > /usr/local/bin/age
printf '%s\n' '#!/bin/bash' 'exit 0' > /usr/local/bin/sleep
chmod 755 /usr/local/bin/age /usr/local/bin/sleep

printf '%s\n' '#!/bin/bash' \
    'set -eu' \
    'n=0; [[ ! -f /tmp/mock-calls ]] || read -r n < /tmp/mock-calls' \
    'n=$((n+1)); printf "%s\n" "$n" > /tmp/mock-calls' \
    '(( n > ${MOCK_FAIL_UNTIL:-0} )) || { echo mock-upload-failure >&2; exit 19; }' \
    'while (($#)); do' \
    '  case "$1" in' \
    '    --body) cp -- "${2#file://}" /tmp/uploaded.age; shift 2 ;;' \
    '    --key) printf "%s\n" "$2" > /tmp/uploaded.key; shift 2 ;;' \
    '    *) shift ;;' \
    '  esac' \
    'done' > /usr/local/bin/ossutil
chmod 755 /usr/local/bin/ossutil

reset_fixture() {
    find /var/backups /etc/transport-order-management-backup -mindepth 1 -delete
    rm -f /tmp/mock-calls /tmp/uploaded.age /tmp/uploaded.key /tmp/test-identity
    mkdir -m 700 "$root"
    chmod 700 "$config"
    age-keygen -o /tmp/test-identity > /tmp/keygen-private.log 2>&1
    age-keygen -y /tmp/test-identity > "$config/age-recipients.txt"
    printf 'mock-credentials-not-real\n' > "$config/ossutilconfig"
    chmod 600 "$config/"*
    printf 'test database fixture\n' | gzip > "$root/mysql_$batch.sql.gz"
    tar -czf "$root/uploads_$batch.tar.gz" --files-from /dev/null
    sha256sum "$root/mysql_$batch.sql.gz" "$root/uploads_$batch.tar.gz" \
        > "$root/manifest_$batch.sha256"
    unset MOCK_FAIL_UNTIL MOCK_AGE_FAIL
}

expect_fail() {
    if bash "$script" "$@" > /tmp/test-output.log 2>&1; then
        printf 'FAIL: command unexpectedly passed\n' >&2
        exit 1
    fi
}

no_upload() {
    [[ ! -e /tmp/mock-calls ]]
}

reset_fixture
bash "$script" "$batch"
[[ "$(cat /tmp/mock-calls)" == 1 ]]
[[ "$(stat -c %a "$root/encrypted/automatic")" == 700 ]]
actual_cipher=( "$root/encrypted/automatic/"*.age )
[[ ${#actual_cipher[@]} == 1 && "$(stat -c %a "${actual_cipher[0]}")" == 600 ]]
[[ -s "${actual_cipher[0]}.uploaded" ]]
mkdir -p /tmp/restored
age-real -d -i /tmp/test-identity /tmp/uploaded.age |
    tar -xzf - -C /tmp/restored
cmp "$root/mysql_$batch.sql.gz" "/tmp/restored/mysql_$batch.sql.gz"
cmp "$root/uploads_$batch.tar.gz" "/tmp/restored/uploads_$batch.tar.gz"
cmp "$root/manifest_$batch.sha256" "/tmp/restored/manifest_$batch.sha256"
printf 'PASS: actual age roundtrip and ciphertext permissions\n'

reset_fixture
export MOCK_FAIL_UNTIL=2
bash "$script" "$batch" > /tmp/test-output.log 2>&1
[[ "$(cat /tmp/mock-calls)" == 3 ]]
printf 'PASS: upload retry succeeds on third attempt\n'

reset_fixture
export MOCK_FAIL_UNTIL=99
expect_fail "$batch"
[[ "$(cat /tmp/mock-calls)" == 3 ]]
pending=( "$root/encrypted/automatic/"*.age )
[[ -s "${pending[0]}" && ! -e "${pending[0]}.uploaded" ]]
[[ -s "${pending[0]}.upload.log" ]]
printf 'PASS: upload failure propagates and retains ciphertext without receipt\n'

reset_fixture
export MOCK_AGE_FAIL=1
expect_fail "$batch"
no_upload
[[ -z "$(find "$root/encrypted/automatic" -type f -print)" ]]
printf 'PASS: encryption failure leaves no final or partial ciphertext\n'

reset_fixture
printf tampered >> "$root/mysql_$batch.sql.gz"
expect_fail "$batch"
no_upload
printf 'PASS: source checksum mismatch prevents upload\n'

reset_fixture
chmod 644 "$config/ossutilconfig"
expect_fail "$batch"
no_upload
printf 'PASS: broad credential permissions rejected\n'

reset_fixture
mv "$config/age-recipients.txt" /tmp/recipient
ln -s /tmp/recipient "$config/age-recipients.txt"
expect_fail "$batch"
no_upload
printf 'PASS: symlinked configuration rejected\n'

reset_fixture
expect_fail '../wrong-batch'
no_upload
printf 'PASS: invalid explicit batch rejected\n'

reset_fixture
touch -d '2 hours ago' "$root/manifest_$batch.sha256"
expect_fail
no_upload
printf 'PASS: stale automatic backup rejected\n'

reset_fixture
bash "$script" > /tmp/test-output.log 2>&1
grep -q "offsite-ok $batch" /tmp/test-output.log
printf 'PASS: automatic latest-batch selection\n'

reset_fixture
(
    flock 9
    expect_fail "$batch"
) 9>/run/lock/transport-order-management-offsite.lock
no_upload
printf 'PASS: concurrent offsite run rejected\n'

reset_fixture
bash "$script" "$batch" > /tmp/test-output.log 2>&1
old=( "$root/encrypted/automatic/"*.age )
touch -d '15 days ago' "${old[0]}" "${old[0]}.uploaded"
printf 'manual backup\n' > "$root/encrypted/keep.tar.gz.enc"
printf 'unconfirmed ciphertext\n' > "$root/encrypted/automatic/backup_20261001-010101_abcdefghij.tar.gz.age"
touch -d '20 days ago' "$root/encrypted/automatic/backup_20261001-010101_abcdefghij.tar.gz.age"
bash "$script" "$batch" > /tmp/test-output.log 2>&1
[[ ! -e "${old[0]}" && ! -e "${old[0]}.uploaded" ]]
[[ -s "$root/encrypted/keep.tar.gz.enc" && -s "$root/mysql_$batch.sql.gz" ]]
[[ -s "$root/encrypted/automatic/backup_20261001-010101_abcdefghij.tar.gz.age" ]]
printf 'PASS: retention deletes only old confirmed automatic ciphertext\n'

reset_fixture
bash "$script" "$batch" > /tmp/test-output.log 2>&1
old=( "$root/encrypted/automatic/"*.age )
printf 'corrupt receipt\n' > "${old[0]}.uploaded"
touch -d '15 days ago' "${old[0]}.uploaded"
expect_fail "$batch"
[[ -s "${old[0]}" && -s "${old[0]}.uploaded" ]]
printf 'PASS: invalid retention receipt preserves ciphertext and reports failure\n'

reset_fixture
bash "$script" "$batch" > /tmp/test-output.log 2>&1
old=( "$root/encrypted/automatic/"*.age )
printf changed >> "${old[0]}"
touch -d '15 days ago' "${old[0]}.uploaded"
expect_fail "$batch"
[[ -s "${old[0]}" && -s "${old[0]}.uploaded" ]]
printf 'PASS: changed retained ciphertext is not deleted\n'

reset_fixture
mkdir -m 700 "$root/encrypted"
ln -s /tmp "$root/encrypted/automatic"
expect_fail "$batch"
no_upload
printf 'PASS: symlinked output directory rejected\n'

reset_fixture
head -n 1 "$root/manifest_$batch.sha256" > /tmp/incomplete-manifest
cp /tmp/incomplete-manifest "$root/manifest_$batch.sha256"
expect_fail "$batch"
no_upload
printf 'PASS: incomplete source manifest rejected\n'
printf 'OFFSITE_FIXTURE_TESTS_OK\n'
