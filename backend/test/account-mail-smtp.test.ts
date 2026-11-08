import type * as Nodemailer from 'nodemailer';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type TLSSocket } from 'node:tls';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const local = vi.hoisted(() => ({ port: 0, ca: '', rejectAfterData: false, messages: [] as string[] }));
vi.mock('../src/config.js', () => ({ config: () => ({ INVITATION_EMAIL_ENABLED:true,INVITATION_EMAIL_PROVIDER:'smtp',
  SMTP_HOST:'localhost',SMTP_PORT:465,SMTP_USER:'local-sender@example.test',SMTP_PASSWORD:'local-test-only',PUBLIC_URL:'https://app2.thatcampus.com' }) }));
vi.mock('nodemailer', async original => {
  const actual = await original<typeof Nodemailer>();
  return { default: { createTransport(options: Record<string,unknown>) {
    // Production still requests verified TLS. Only this isolated fake server's
    // port and CA are substituted; there is no Internet SMTP connection.
    expect(options).toMatchObject({secure:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},debug:false});
    return actual.default.createTransport({ ...options, host:'127.0.0.1', port:local.port, tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,ca:local.ca,servername:'localhost'} });
  } } };
});
import { deliverAccountAction } from '../src/common/account-email.js';

describe('account email through real Nodemailer and a loopback TLS SMTP server', () => {
  let server: Server, directory: string;
  const sockets = new Set<TLSSocket>();
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(),'thatcampus-local-smtp-'));
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
    const [key,cert] = await Promise.all([readFile(join(directory,'key.pem')),readFile(join(directory,'cert.pem'))]); local.ca=cert.toString();
    server = createServer({key,cert,minVersion:'TLSv1.2'}, socket => {
      sockets.add(socket); socket.on('close',()=>sockets.delete(socket));
      socket.setEncoding('utf8'); socket.write('220 localhost local test SMTP\r\n');
      let buffer='', data=false;
      socket.on('data', (chunk:string) => {
        buffer+=chunk;
        while(buffer.includes('\r\n')) {
          if(data) {
            const end=buffer.indexOf('\r\n.\r\n'); if(end<0) return;
            local.messages.push(buffer.slice(0,end)); buffer=buffer.slice(end+5); data=false;
            if(local.rejectAfterData) { socket.destroy(); return; }
            socket.write('250 2.0.0 accepted-local-message\r\n'); continue;
          }
          const end=buffer.indexOf('\r\n'), line=buffer.slice(0,end); buffer=buffer.slice(end+2);
          if(line.startsWith('EHLO')) socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 1000000\r\n');
          else if(line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 local authentication accepted\r\n');
          else if(line==='DATA') { data=true; socket.write('354 end with dot\r\n'); }
          else if(line==='QUIT') socket.end('221 closing\r\n');
          else socket.write('250 OK\r\n');
        }
      });
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address(); if(!address || typeof address==='string') throw new Error('Local SMTP address missing'); local.port=address.port;
  });
  beforeEach(()=>{local.messages=[];local.rejectAfterData=false;});
  afterAll(async()=>{for(const socket of sockets) socket.destroy(); if(server) await new Promise<void>(resolve=>server.close(()=>resolve())); if(directory) await rm(directory,{recursive:true,force:true});});
  it('completes TLS/auth/envelope/DATA acceptance with a fragment-only HTTPS account link', async()=>{
    const token='test-only-token-'.padEnd(43,'x');
    const result=await deliverAccountAction({email:'local-recipient@example.test',token,purpose:'password_reset',expiresAt:new Date('2099-01-01'),idempotencyKey:'account-action/local-test'});
    expect(result).toMatchObject({delivery:'email_accepted'}); expect(local.messages).toHaveLength(1);
    const body=local.messages[0]!.replaceAll('=\r\n','').replaceAll('=3D','=');
    expect(body).toContain(`https://app2.thatcampus.com/reset-password#token=${token}`);
    expect(body).not.toContain('/reset-password?token='); expect(body).toContain('Message-ID: <account-action.local-test@thatcampus.com>');
  });
  it('does not invent acceptance after DATA when the local server disconnects before confirming',async()=>{
    local.rejectAfterData=true;
    const result=await deliverAccountAction({email:'local-recipient@example.test',token:'local-private-token',purpose:'email_verification',expiresAt:new Date('2099-01-01')});
    expect(result).toMatchObject({delivery:'failed',failure_category:'connection'}); expect(local.messages).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/local-private-token|local-test-only|local-recipient/);
  });
});
