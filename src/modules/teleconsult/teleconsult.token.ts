import crypto from "node:crypto";
import { RtcRole, RtcTokenBuilder } from "agora-token";

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60;

export function buildAgoraRtcToken(params: {
  appId: string;
  appCertificate: string;
  channelName: string;
  userId: string;
  ttlSeconds?: number;
}) {
  const { appId, appCertificate, channelName, userId, ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS } = params;
  if (!appId || !appCertificate || !channelName || !userId) {
    return null;
  }

  const privilegeExpiredTs = Math.floor(Date.now() / 1000) + ttlSeconds;
  return RtcTokenBuilder.buildTokenWithUserAccount(
    appId,
    appCertificate,
    channelName,
    userId,
    RtcRole.PUBLISHER,
    privilegeExpiredTs,
    privilegeExpiredTs
  );
}

// Zego token04 server-side build using app_id + server secret.
export function buildZegoToken04(params: {
  appId: number;
  userId: string;
  secret: string;
  ttlSeconds?: number;
  payload?: string;
}) {
  const { appId, userId, secret, ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS, payload = "" } = params;
  if (!appId || !userId || !secret || secret.length !== 32) {
    return null;
  }

  const nonce = crypto.randomInt(-2147483648, 2147483647);
  const ctime = Math.floor(Date.now() / 1000);
  const expire = ctime + ttlSeconds;

  const body = JSON.stringify({
    app_id: appId,
    user_id: userId,
    nonce,
    ctime,
    expire,
    payload,
  });

  const ivChars = "0123456789abcdefghijklmnopqrstuvwxyz";
  const iv = Buffer.from(
    Array.from({ length: 16 }, () => ivChars[Math.floor(Math.random() * ivChars.length)]).join(""),
    "utf8"
  );
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(secret, "utf8"), iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);

  const expireBuf = Buffer.alloc(8);
  expireBuf.writeBigInt64BE(BigInt(expire), 0);

  const ivLengthBuf = Buffer.alloc(2);
  ivLengthBuf.writeUInt16BE(iv.length, 0);

  const encryptedLengthBuf = Buffer.alloc(2);
  encryptedLengthBuf.writeUInt16BE(encrypted.length, 0);

  const packet = Buffer.concat([expireBuf, ivLengthBuf, iv, encryptedLengthBuf, encrypted]);
  return `04${packet.toString("base64")}`;
}
