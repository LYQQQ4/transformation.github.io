const http = require("http");

function testLogin(username, password, description) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ username, password });
    const request = http.request({
      hostname: "127.0.0.1",
      port: Number(process.env.TEST_PORT || 3000),
      path: "/api/users/login",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    }, (response) => {
      let data = "";
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`${description}: HTTP ${response.statusCode}; response body omitted`);
          resolve({ status: response.statusCode, data: parsed });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(5000, () => {
      request.destroy(new Error("Timeout"));
    });
    request.write(postData);
    request.end();
  });
}

async function testLoginFunctionality() {
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    throw new Error("Set TEST_USERNAME and TEST_PASSWORD to run this smoke test");
  }
  await testLogin(
    process.env.TEST_USERNAME,
    process.env.TEST_PASSWORD,
    "Configured login"
  );
}

if (require.main === module) {
  testLoginFunctionality().catch((error) => {
    console.error("Login smoke test failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { testLogin };
