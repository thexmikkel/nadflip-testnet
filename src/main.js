// main.js Reown AppKit multi wallet support
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { monadTestnet } from '@reown/appkit/networks';
import { ethers } from 'ethers';

console.log("🔥 NadFlip main.js is running");

const nadflipKit = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [monadTestnet],
  projectId: 'projectkey',
  metadata: {
    name: 'NadFlip',
    description: 'Flip MON on Monad Testnet',
    url: 'https://app.nadflip.com',
    icons: ['https://app.nadflip.com/nadflip.png'],
  },
  features: {
    socials: false,
    email: false,
    swaps: false,
    onramp: false,
  }
});

window.nadflipKit = nadflipKit;

function shorten(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

let lastAddress = null;

// Poll every second to check if the wallet is connected or changed
setInterval(async () => {
  try {
    const provider = nadflipKit.getProvider("eip155");

    // Attach listeners once
    if (provider && !provider._nadflipListenersAttached) {
      provider.on("accountsChanged", () => {
        console.log("Accounts changed — triggering reconnection.");
        lastAddress = null; // force reconnection
      });

      provider.on("disconnect", () => {
        console.log("Provider disconnected.");
        safeDisconnect();
      });

      provider._nadflipListenersAttached = true;
    }

    // Try to reconnect if possible
    if (provider) {
      const browserProvider = new ethers.BrowserProvider(provider);
      const signer = await browserProvider.getSigner();
      const address = await signer.getAddress();

      if (!window.connected || address !== lastAddress) {
        const balance = await browserProvider.getBalance(address);
        const mon = parseFloat(ethers.formatEther(balance)).toFixed(4);

        window.connected = true;
        window.signer = signer;
        window.provider = provider;
        window.playerAddress = address;
        lastAddress = address;

        console.log(`Connected: ${address} | ${mon} MON`);

        if (typeof loadMyStats === 'function') loadMyStats(address);
        if (typeof loadRecentFlips === 'function') await loadRecentFlips();
      }
    }
  } catch (err) {
    if (window.connected) {
      console.warn("Disconnected or error:", err);
      await safeDisconnect();
    }
  }
}, 1000);
// Add disconnect function with stale check
async function safeDisconnect() {
  try {
    const provider = window.nadflipKit?.getProvider?.("eip155");
    if (provider && window.nadflipKit.disconnect) {
      await window.nadflipKit.disconnect();
    } else {
      console.warn("No active session to disconnect.");
    }
  } catch (err) {
    console.error("Error during disconnect:", err);
  }

  // Reset application state
  window.connected = false;
  window.signer = null;
  window.provider = null;
  window.playerAddress = null;
  lastAddress = null;

  // Update UI
  const connectBtn = document.getElementById("connectBtn");
  if (connectBtn) connectBtn.textContent = "Connect Wallet";

  const balanceEl = document.getElementById("monBalance");
  if (balanceEl) balanceEl.textContent = "";
}
// Load recent flips right away on page load
window.addEventListener("DOMContentLoaded", async () => {
  if (typeof loadRecentFlips === 'function') {
    await loadRecentFlips();
  }
});
