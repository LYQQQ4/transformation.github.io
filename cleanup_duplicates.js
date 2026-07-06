const mysql = require("mysql2/promise");

async function cleanupDuplicates() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Sidel!2345",
    database: "order_system"
  });

  try {
    console.log("开始清理重复数据...");

    // 1. 检查并删除重复的orders记录（保留ID最小的）
    console.log("检查orders表重复记录...");
    const [duplicateOrders] = await connection.execute(`
      SELECT serial_number, GROUP_CONCAT(id ORDER BY id) as ids, COUNT(*) as count
      FROM orders
      GROUP BY serial_number
      HAVING count > 1
    `);

    for (const dup of duplicateOrders) {
      const ids = dup.ids.split(',');
      const keepId = ids[0]; // 保留最小的ID
      const deleteIds = ids.slice(1);

      console.log(`删除重复orders记录: serial_number=${dup.serial_number}, 保留ID=${keepId}, 删除IDs=${deleteIds.join(',')}`);

      await connection.execute(
        "DELETE FROM orders WHERE id IN (?) AND serial_number = ?",
        [deleteIds, dup.serial_number]
      );
    }

    // 2. 检查并删除重复的package记录
    console.log("检查package表重复记录...");
    const [duplicatePackages] = await connection.execute(`
      SELECT serial_number, GROUP_CONCAT(id ORDER BY id) as ids, COUNT(*) as count
      FROM \`package\`
      GROUP BY serial_number
      HAVING count > 1
    `);

    for (const dup of duplicatePackages) {
      const ids = dup.ids.split(',');
      const keepId = ids[0];
      const deleteIds = ids.slice(1);

      console.log(`删除重复package记录: serial_number=${dup.serial_number}, 保留ID=${keepId}, 删除IDs=${deleteIds.join(',')}`);

      await connection.execute(
        "DELETE FROM \`package\` WHERE id IN (?) AND serial_number = ?",
        [deleteIds, dup.serial_number]
      );
    }

    // 3. 检查并删除重复的transfer记录
    console.log("检查transfer表重复记录...");
    const [duplicateTransfers] = await connection.execute(`
      SELECT serial_number, GROUP_CONCAT(id ORDER BY id) as ids, COUNT(*) as count
      FROM transfer
      GROUP BY serial_number
      HAVING count > 1
    `);

    for (const dup of duplicateTransfers) {
      const ids = dup.ids.split(',');
      const keepId = ids[0];
      const deleteIds = ids.slice(1);

      console.log(`删除重复transfer记录: serial_number=${dup.serial_number}, 保留ID=${keepId}, 删除IDs=${deleteIds.join(',')}`);

      await connection.execute(
        "DELETE FROM transfer WHERE id IN (?) AND serial_number = ?",
        [deleteIds, dup.serial_number]
      );
    }

    // 4. 删除孤立的记录（没有对应orders的package和transfer记录）
    console.log("删除孤立的package记录...");
    const [orphanedPackages] = await connection.execute(`
      SELECT p.serial_number
      FROM \`package\` p
      LEFT JOIN orders o ON p.serial_number = o.serial_number
      WHERE o.serial_number IS NULL
    `);

    for (const orphan of orphanedPackages) {
      console.log(`删除孤立package记录: serial_number=${orphan.serial_number}`);
      await connection.execute("DELETE FROM \`package\` WHERE serial_number = ?", [orphan.serial_number]);
    }

    console.log("删除孤立的transfer记录...");
    const [orphanedTransfers] = await connection.execute(`
      SELECT t.serial_number
      FROM transfer t
      LEFT JOIN orders o ON t.serial_number = o.serial_number
      WHERE o.serial_number IS NULL
    `);

    for (const orphan of orphanedTransfers) {
      console.log(`删除孤立transfer记录: serial_number=${orphan.serial_number}`);
      await connection.execute("DELETE FROM transfer WHERE serial_number = ?", [orphan.serial_number]);
    }

    // 5. 验证清理结果
    console.log("\\n=== 清理后的数据统计 ===");
    const [orderCount] = await connection.execute('SELECT COUNT(*) as count FROM orders');
    const [packageCount] = await connection.execute('SELECT COUNT(*) as count FROM \`package\`');
    const [transferCount] = await connection.execute('SELECT COUNT(*) as count FROM transfer');

    console.log(`Orders: ${orderCount[0].count}`);
    console.log(`Package: ${packageCount[0].count}`);
    console.log(`Transfer: ${transferCount[0].count}`);

    // 检查是否还有重复
    const [finalDuplicates] = await connection.execute(`
      SELECT
        (SELECT COUNT(*) FROM (SELECT serial_number, COUNT(*) FROM orders GROUP BY serial_number HAVING COUNT(*) > 1) t1) as order_dups,
        (SELECT COUNT(*) FROM (SELECT serial_number, COUNT(*) FROM \`package\` GROUP BY serial_number HAVING COUNT(*) > 1) t2) as package_dups,
        (SELECT COUNT(*) FROM (SELECT serial_number, COUNT(*) FROM transfer GROUP BY serial_number HAVING COUNT(*) > 1) t3) as transfer_dups
    `);

    console.log("\\n重复检查结果:");
    console.log(`Orders重复: ${finalDuplicates[0].order_dups}`);
    console.log(`Package重复: ${finalDuplicates[0].package_dups}`);
    console.log(`Transfer重复: ${finalDuplicates[0].transfer_dups}`);

    console.log("\\n数据清理完成！");

  } catch (error) {
    console.error("清理过程中出错:", error);
  } finally {
    await connection.end();
  }
}

cleanupDuplicates();
