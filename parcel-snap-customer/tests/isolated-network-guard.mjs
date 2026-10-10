// Every app transport in isolated tests must be injected. This guard makes an
// accidental global HTTP/socket fallback fail closed before it can connect.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {after} from 'node:test';
import assert from 'node:assert/strict';
let attempts=0;
const blocked=()=>{attempts++;throw new Error('External network and socket access are forbidden in this isolated test.');};
globalThis.fetch=blocked;
net.Socket.prototype.connect=blocked;
net.connect=net.createConnection=blocked;
tls.connect=blocked;
http.request=http.get=https.request=https.get=blocked;
after(()=>assert.equal(attempts,0,'No test may attempt external network/socket access, even if the app catches the error.'));
