// Run npm run test:audio:browser, open the printed URL in Chromium, then press Run.
const express = require('express');
const path = require('node:path');
const app = express();
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'audio-playback.browser.html')));
app.use('/module', express.static(path.join(__dirname, '../client/src')));
app.use(express.static(path.join(__dirname, '../client/public')));
app.listen(55101, '127.0.0.1', () => console.log('Audio browser regression: http://127.0.0.1:55101'));
