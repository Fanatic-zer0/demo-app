const { createApp } = require('./server');

const port = Number(process.env.PORT || 8080);
createApp().listen(port, () => {
  console.log(`web-ui listening on ${port}`);
});
