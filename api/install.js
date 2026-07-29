export default function handler(req, res) {
  res.status(200).send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://api.bitrix24.com/api/v1/"></script>
</head>
<body>
  <p>Finalizando instalação...</p>

  <script>
    BX24.init(function () {
      BX24.installFinish();

      setTimeout(function () {
        window.location.href = "/";
      }, 500);
    });
  </script>
</body>
</html>
  `);
}
