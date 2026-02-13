import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as morgan from 'morgan';
import signaling from './signaling';
import { log, LogLevel } from './log';
import Options from './class/options';
import { reset as resetHandler }from './class/httphandler';

const cors = require('cors');

export const createServer = (config: Options): express.Application => {
  const app: express.Application = express();
  const basePath = '/rs';
  const publicDir = path.join(__dirname, '../client/public');
  const moduleDir = path.join(__dirname, '../client/src');
  resetHandler(config.mode);
  // logging http access
  if (config.logging != "none") {
    app.use(morgan(config.logging));
  }
  // const signal = require('./signaling');
  app.use(cors({origin: '*'}));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  const sendIndex = (res: express.Response): void => {
    const indexPagePath: string = path.join(publicDir, 'index.html');
    fs.access(indexPagePath, (err) => {
      if (err) {
        log(LogLevel.warn, `Can't find file ' ${indexPagePath}`);
        res.status(404).send(`Can't find file ${indexPagePath}`);
      } else {
        res.sendFile(indexPagePath);
      }
    });
  };

  app.get('/config', (req, res) => res.json({ useWebSocket: config.type == 'websocket', startupMode: config.mode, logging: config.logging }));
  app.get(`${basePath}/config`, (req, res) => res.json({ useWebSocket: config.type == 'websocket', startupMode: config.mode, logging: config.logging }));

  app.use('/signaling', signaling);
  app.use(`${basePath}/signaling`, signaling);

  const staticOptions = {
    etag: true,
    setHeaders: (res) => {
      // Avoid stale mixed-version JS module caches after client deploys.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  };

  app.use(basePath, express.static(publicDir, staticOptions));
  app.use(`${basePath}/module`, express.static(moduleDir, staticOptions));

  app.get('/', (req, res) => res.redirect(`${basePath}/index.html`));
  app.get('/receiver', (req, res) => res.redirect(`${basePath}/index.html`));
  app.get('/receiver/', (req, res) => res.redirect(`${basePath}/index.html`));
  app.get(`${basePath}/`, (req, res) => sendIndex(res));
  app.get(basePath, (req, res) => res.redirect(`${basePath}/`));
  return app;
};
