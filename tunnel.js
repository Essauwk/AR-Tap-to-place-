const localtunnel = require('localtunnel');
const os = require('os');

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

(async () => {
  console.log('Starting secure tunnel, please wait...');
  try {
    const tunnel = await localtunnel({ port: 8080 });
    const localIp = getLocalIp();
    
    console.log('\n======================================================');
    console.log('✅ السيرفر شغال وجاهز للاستخدام!');
    console.log('💻 رابط اللاب توب: http://localhost:8080');
    console.log(`🏠 رابط الشبكة (نفس الواي فاي): http://${localIp}:8080`);
    console.log('📱 رابط الموبايل (عن بعد):  ' + tunnel.url);
    console.log('======================================================');
    console.log('الخطوات:');
    console.log('1. افتح رابط الموبايل (https) على Safari أو Chrome.');
    console.log('   (ملحوظة: الـ AR بيحتاج https، فرابط الشبكة ممكن ميفتحش الكاميرا)');
    console.log('   • Android Chrome: START AR (WebXR — Three.js)');
    console.log('   • iPhone Safari/Chrome: START AR (model-viewer — free AR)');
    console.log('2. لو ظهرتلك صفحة فيها زرار "Click to Continue"، دوس عليه.');
    console.log('3. متقفلش الشاشة السودا دي طول ما انت بتجرب.');
    console.log('======================================================\n');

    tunnel.on('close', () => {
      console.log('❌ تم إغلاق السيرفر.');
    });
  } catch (err) {
    console.error('حدث خطأ أثناء تشغيل السيرفر:', err);
  }
})();
