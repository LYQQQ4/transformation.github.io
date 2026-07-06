const http = require('http');

// 测试登录功能
function testLogin(username, password, description) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      username: username,
      password: password
    });

    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/users/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          console.log(`🔐 ${description}:`);
          console.log(`   状态码: ${res.statusCode}`);

          if (res.statusCode === 200) {
            console.log(`   ✅ 登录成功`);
            console.log(`   👤 用户: ${jsonData.user.username} (${jsonData.user.role})`);
          } else {
            console.log(`   ❌ 登录失败: ${jsonData.error}`);
          }

          console.log('');
          resolve({ status: res.statusCode, data: jsonData });
        } catch (e) {
          console.log(`   ❌ 响应解析错误: ${data}`);
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', (err) => {
      console.log(`❌ ${description}: 连接失败 - ${err.message}\n`);
      reject(err);
    });

    req.setTimeout(5000, () => {
      console.log(`❌ ${description}: 超时\n`);
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(postData);
    req.end();
  });
}

async function testLoginFunctionality() {
  console.log("🔐 测试登录功能...\n");

  try {
    // 测试有效的用户登录
    console.log("📋 测试用例:");
    console.log("=".repeat(50));

    // 测试用户登录
    await testLogin('test_user', '123456', '普通用户登录 (test_user/123456)');

    // 测试管理员登录
    await testLogin('林彦琦', '123456', '管理员登录 (林彦琦/123456)');

    // 测试另一个管理员登录
    await testLogin('lyq', '123456', '管理员登录 (lyq/123456)');

    // 测试无效用户名
    await testLogin('nonexistent', '123456', '无效用户名登录');

    // 测试错误密码
    await testLogin('test_user', 'wrongpass', '错误密码登录');

    // 测试空用户名
    await testLogin('', '123456', '空用户名登录');

    // 测试空密码
    await testLogin('test_user', '', '空密码登录');

    console.log("✅ 登录功能测试完成");

  } catch (error) {
    console.log('❌ 测试过程中出现错误:', error.message);
  }
}

testLoginFunctionality();