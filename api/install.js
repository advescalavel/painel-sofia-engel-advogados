export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  res.status(200).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <script
      src="https://api.bitrix24.com/b24.js"
      onload="console.log('b24.js carregado')"
      onerror="console.error('Erro ao carregar b24.js')">
    </script>
</head>
<body>

<h2>Instalando...</h2>

<script>
window.addEventListener('load', () => {
    console.log('window.BX24 =', window.BX24);

    if (!window.BX24) {
        document.body.innerHTML += '<br><b>BX24 NÃO CARREGOU</b>';
        return;
    }

    BX24.init(function () {
        console.log('Init OK');

        BX24.installFinish(function () {
            console.log('Install OK');
        });
    });
});
</script>

</body>
</html>
`);
}
