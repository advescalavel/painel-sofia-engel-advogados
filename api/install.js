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
    BX24.init(function () {
      console.log("BX24 iniciado");
      BX24.installFinish();
    });
  </script>
</body>
</html>
  `);
}
