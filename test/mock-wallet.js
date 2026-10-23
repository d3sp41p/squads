// Dev-only fake Phantom for testing sign-in without a wallet extension.
// Load /dev/nacl.js first. Pick a wallet with localStorage.mockSeed = "2" (any string) before connecting.
(() => {
  const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = bytes => {
    let n = 0n;
    for (const b of bytes) n = n * 256n + BigInt(b);
    let s = "";
    while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b) break; s = "1" + s; }
    return s;
  };
  const seed = new Uint8Array(32);
  new TextEncoder().encode("enlist-mock-" + (localStorage.mockSeed || "1")).forEach((b, i) => (seed[i % 32] ^= b));
  const kp = nacl.sign.keyPair.fromSeed(seed);
  const publicKey = { toString: () => b58(kp.publicKey) };
  window.phantom = {
    solana: {
      isPhantom: true,
      publicKey,
      connect: async () => ({ publicKey }),
      signMessage: async msg => ({ signature: nacl.sign.detached(msg, kp.secretKey), publicKey }),
    },
  };
})();
