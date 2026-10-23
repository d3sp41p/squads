import bs58 from "bs58";
import nacl from "tweetnacl";

export function isAddress(s) {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  try {
    return bs58.decode(s).length === 32;
  } catch {
    return false;
  }
}

export const signInMessage = nonce =>
  `Sign in to Enlist: ${nonce}\n\nThis only proves you own this wallet. It is not a transaction and costs nothing.`;

// signature: base64 of the 64-byte ed25519 signature the wallet returned.
export function verifySignature(message, signature, address) {
  try {
    const sig = Buffer.from(signature, "base64");
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, bs58.decode(address));
  } catch {
    return false;
  }
}
