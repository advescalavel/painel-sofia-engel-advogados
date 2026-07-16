export default function handler(req, res) {
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
      <body>
        <script>
          window.location.href = "/";
        </script>
      </body>
    </html>
  `);
}
