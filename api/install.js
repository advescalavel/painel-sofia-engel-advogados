export default function handler(req, res) {
  res.status(200).send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="//api.bitrix24.com/b24.js"></script>
</head>
<body>
  <p>Finalizando instalação...</p>

  <script>
console.log("window.BX24 =", window.BX24);

if (!window.BX24) {
    console.error("SDK do Bitrix não carregou.");
} else {
    BX24.init(function () {
        console.log("BX24 iniciado");
        BX24.installFinish();
    });
}
</script>
</body>
</html>
  `);
}
