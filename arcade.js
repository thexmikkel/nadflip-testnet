const maintenance = false;

if (maintenance) {
  window.location.href = "/maintenance.html";
}

import { ethers, Interface } from "ethers";
import confetti from 'https://cdn.skypack.dev/canvas-confetti';

const contractAddress = "0x5E447c5588C551E9959CEc493a40b52768B3d8AE";
const abi = [
  "function flipCoin(bool guessHigh) external payable",
  "function getJackpotPool() external view returns (uint256)",
  "function getBalance() external view returns (uint256)",
  "function flipCount() external view returns (uint256)",
  "function getMyStats(address player) external view returns (uint256 totalFlips, uint256 wins, uint256 jackpots, uint256 wagered, uint256 paidOut)",
  "function getRecentFlips(uint256 count) external view returns (uint256[] memory, address[] memory, uint88[] memory, uint32[] memory, bool[] memory, bool[] memory, bool[] memory)",
  "function getRecentFlipsCount() external view returns (uint256)",
  "function getRecentJackpotWins(uint count) external view returns (address[] memory players, uint256[] memory amounts, uint32[] memory timestamps)",
  "function withdraw(uint256 amount) external",
  "function setBetRange(uint256 _min, uint256 _max) external",
  "function setFees(uint256 _devFee, uint256 _houseEdge) external",
  "function setDevWallet(address _wallet) external",
  "function fundJackpotWithMessage(string message) external payable",
  "event FlipResult(address indexed player, uint256 rolledNumber, bool won, bool jackpot, uint256 amount, bool guessHigh)",
  "event Received(address indexed sender, uint256 amount)",
  "event JackpotFunded(address indexed sender, uint256 amount, string message)",
  "event FlipRefunded(address indexed player, uint256 requestId, uint256 amount)",
  "function getCurrentFee() external view returns (uint128)"
];

let readProvider;
let readContract;
let playerAddress;
let spinInterval;
let spinAngle = 0;
let myFlips = [];
let recentFlips = [];
let awaitingFlip = false;
let lastFlipGuess = null;
let lastFlipTime = 0;
let connectBtn;
let walletStatus;
let coin;
let winAmountDisplay;
let betInput;
let flipBtn;
let contract;
let currentRecentPage = 1;
let currentMyPage = 1;
let flipsPerPage = 15;
let lastFlipId = null;
let lastFlipRolled = null;

function subscribeToEvents(contractInstance) {
  if (window.__nadflipEventsAttached) return;
  if (!contractInstance) {
    console.warn("❌ Contract not ready — cannot subscribe to events.");
    return;
  }

  window.__nadflipEventsAttached = true;

  contractInstance.removeAllListeners("FlipResult");

  contractInstance.on("FlipResult", async (player, rolledNumber, won, jackpot, amount, guessHigh) => {
    console.log("🎯 FlipResult EVENT FIRED", {
      player,
      rolledNumber: Number(rolledNumber),
      won,
      jackpot,
      amount: ethers.formatEther(amount),
      guessHigh
    });

    try {
      if (!window.playerAddress && window.signer) {
        window.playerAddress = await window.signer.getAddress();
      }

      if (player.toLowerCase() !== window.playerAddress?.toLowerCase()) return;

      const wonAmount = Number(ethers.formatEther(amount)).toFixed(3);
      lastFlipRolled = Number(rolledNumber);
      lastFlipGuess = guessHigh;
      awaitingFlip = false;

      await loadRecentFlips();
      lastFlipId = recentFlips[0]?.id ?? null;
      await updateJackpotPool();
      await loadMyStats(window.playerAddress);

      myFlips = recentFlips.filter(
        f => f.player?.toLowerCase() === window.playerAddress.toLowerCase()
      );
      renderMyRecentFlips();

      stopSpinAndReveal(won, won ? wonAmount : 0, guessHigh);
    } catch (err) {
      console.warn("⚠️ Error handling FlipResult:", err);
    }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    console.log("Tab became active — refreshing recent flips");
    loadRecentFlips();
  }
});

// Finalize fallback after flip if no event received
async function finalizeFallback() {
  if (!awaitingFlip || lastFlipId == null) return;

  try {
    await loadRecentFlips();
  } catch (err) {
    console.warn("finalizeFallback: loadRecentFlips failed", err);
    return;
  }

  const mine = recentFlips.find(f =>
    f.player.toLowerCase() === window.playerAddress.toLowerCase() &&
    f.guessHigh === lastFlipGuess &&
    f.id === lastFlipId
  );

  if (mine) {
    const calculatedWin = (mine.guessHigh && mine.rolled >= 500) || (!mine.guessHigh && mine.rolled < 500);
    if (mine.won !== calculatedWin) {
      console.warn("Mismatch: contract says", mine.won, "calculated:", calculatedWin);
    }

    awaitingFlip = false;
    
    if (window.playerAddress) {
      await loadMyStats(window.playerAddress);
    }
    
    if (window.playerAddress) {
      myFlips = recentFlips.filter(f => f.player?.toLowerCase() === window.playerAddress.toLowerCase());
    }
    renderMyRecentFlips();
    stopSpinAndReveal(calculatedWin, calculatedWin ? mine.amount : 0, mine.guessHigh);
  } else {
    console.warn("Flip not found — forcing fallback loss display.");
    awaitingFlip = false;
    stopSpinAndReveal(false, 0, lastFlipGuess ?? true);
  }
}

async function ensureMonadNetwork() {
  const provider = window.nadflipKit?.getProvider?.("eip155");
  if (!provider) {
    console.warn("No provider found for network check.");
    return false;
  }

  try {
    const currentChainId = await provider.request({ method: 'eth_chainId' });
    console.log("Detected chainId:", currentChainId);

    const monadChainId = "0x279f"; // Monad Testnet
    if (currentChainId !== monadChainId) {
      console.warn(`Not on Monad Testnet. Trying to switch...`);
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: monadChainId }]
      });
      console.log("✅ Successfully switched to Monad Testnet");
    }

    return true;
  } catch (err) {
    console.error("❌ Failed to switch to Monad Testnet:", err);
    alert("Please switch to Monad Testnet to continue.");
    return false;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  connectBtn = document.getElementById("connectBtn");
  walletStatus = document.getElementById("walletStatus");
  coin = document.getElementById("coin");
  winAmountDisplay = document.getElementById("winAmount");
  betInput = document.getElementById("betAmount");
  betInput.disabled = false;
  betInput.addEventListener("focus", () => betInput.select());
  flipBtn = document.getElementById("flipBtn");

  readProvider = new ethers.JsonRpcProvider("https://monad-testnet.g.alchemy.com/v2/TlhjBg6q2GbrpJ71DGqu-erKGuJPuvT0");
  readContract = new ethers.Contract(contractAddress, abi, readProvider);
  
  // new polling
  // Store the last processed block number
let lastProcessedBlock = await readProvider.getBlockNumber();

// Function to poll for new FlipResult events
async function pollFlipResults() {
  try {
    const currentBlock = await readProvider.getBlockNumber();
    const filter = readContract.filters.FlipResult(window.playerAddress);

    // Query for events from the last processed block to the current block
    const events = await readContract.queryFilter(filter, lastProcessedBlock + 1, currentBlock);

    for (const event of events) {
      const { player, rolledNumber, won, jackpot, amount, guessHigh } = event.args;

      // Process only events related to the current user
      if (player.toLowerCase() !== window.playerAddress.toLowerCase()) continue;

      const wonAmount = Number(ethers.formatEther(amount)).toFixed(3);
      lastFlipRolled = Number(rolledNumber);
      lastFlipGuess = guessHigh;
      awaitingFlip = false;

      // Refresh frontend data
      await loadRecentFlips();
      lastFlipId = recentFlips[0]?.id ?? null;
      await updateJackpotPool();
      await loadMyStats(window.playerAddress);

      myFlips = recentFlips.filter(
        f => f.player?.toLowerCase() === window.playerAddress.toLowerCase()
      );
      renderMyRecentFlips();

      stopSpinAndReveal(won, won ? wonAmount : 0, guessHigh);
    }

    // Update the last processed block number
    lastProcessedBlock = currentBlock;
  } catch (err) {
    console.warn("Error polling FlipResult events:", err);
  }
}

// Start polling every 5 seconds
setInterval(pollFlipResults, 5000);
  // end of new polling

  
  playerAddress = window.playerAddress;
  // Flip button logic

  flipBtn.addEventListener("click", async () => {
    console.log("Flip button clicked");
  if (!window.nadflipKit?.getIsConnectedState?.()) {
  return alert("Connect your wallet first.");
}

const ok = await ensureMonadNetwork();
if (!ok) return;
    let signer;
try {
  const provider = window.nadflipKit.getProvider("eip155");
  signer = await new ethers.BrowserProvider(provider).getSigner();
} catch (err) {
  console.warn("Failed to get signer from AppKit", err);
  return alert("Unable to get signer");
}
  contract = new ethers.Contract(contractAddress, abi, signer);
    const betAmount = betInput.value;
    console.log("Signer address:", await signer.getAddress());
    
  if (!betAmount || isNaN(betAmount) || Number(betAmount) <= 0) {
    return alert("Enter valid amount");
  }

  const guess = document.querySelector("input[name='betSide']:checked").value === "win";

  flipBtn.disabled = true;
  lastFlipGuess = guess;
  startSpinning();

  try {
    const tx = await contract.flipCoin(guess, {
      value: ethers.parseEther(betAmount),
      gasLimit: 600000
    });
    
    console.log("Tx sent:", tx.hash);
    console.log("Waiting for FlipResult event via Gelato VRF...");
    
  } catch (err) {
  console.warn("Flip failed", err);
  awaitingFlip = false;
  clearInterval(spinInterval);
  coin.style.transition = "transform 0.5s ease-out";
  coin.style.transform = `rotateY(0deg)`; // always front side
  document.getElementById("winAmount").textContent = "";
  document.getElementById("lossAmount").textContent = "";
  coin.classList.remove("coin-glow-win", "coin-glow-loss");
  alert("Flip failed or rejected. Try again.");
  } finally {
    flipBtn.disabled = false;
  }
});
  
  // Increment & clear buttons
  document.querySelectorAll(".increment-bar button").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const val = e.target.dataset.inc;
      if (!val) return;
      let current = parseFloat(betInput.value) || 0;
      if (val === "x2") {
        current *= 2;
      } else {
        current += parseFloat(val);
      }
      betInput.value = current.toFixed(3);
    });
  });

  document.getElementById("clearAmount").onclick = () => {
    betInput.value = "";
  };

  await loadContractStats();
  await updateJackpotPool();

try {
  const provider = window.nadflipKit?.getProvider?.("eip155");
  if (!provider) {
    console.warn("❌ Provider not ready — skipping event listener setup.");
  } else {
    const signer = await new ethers.BrowserProvider(provider).getSigner();
    contract = new ethers.Contract(contractAddress, abi, signer);
    pollFlipResults();
  }
} catch (err) {
  console.error("Failed to set up contract and event listener:", err);
}
  
setInterval(() => {
  if (readContract) updateJackpotPool();
}, 7000);

setInterval(() => {
  if (awaitingFlip) finalizeFallback();
}, 4000);
  
  await loadRecentFlips();
  
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadRecentFlips();
    }
  });

const isConnected = window.nadflipKit?.getIsConnectedState?.();
toggleConnectedUI(isConnected);

  if (window.nadflipKit?.onStateChanged) {
  window.nadflipKit.onStateChanged((state) => {
    const connected = state?.isConnected ?? false;
    toggleConnectedUI(connected);
  });
  }
  
});

  function startSpinning() {
  coin.style.transition = "none";
  spinAngle = 0;

  document.getElementById("winAmount").textContent = "";
  document.getElementById("lossAmount").textContent = "";

  spinInterval = setInterval(() => {
    spinAngle += 20;
    coin.style.transform = `rotateY(${spinAngle}deg)`;
  }, 50);
  }

  function stopSpinAndReveal(isWin, amount = 0, guessHigh = true) {
  if (spinInterval) clearInterval(spinInterval);
  coin.style.transition = "transform 1.5s ease-out";
  spinAngle = spinAngle % 360;

  // Determine result side based on guess and outcome
  const winSideIsHigh = guessHigh;
  const resultIsHigh = isWin ? winSideIsHigh : !winSideIsHigh;

  const currentRotation = spinAngle % 360;
  const neededRotation = resultIsHigh ? 0 : 180;
  const extraRotation = (360 - currentRotation + neededRotation) % 360;
  const finalAngle = spinAngle + 720 + extraRotation;

  coin.style.transform = `rotateY(${finalAngle}deg)`;

  // Clear both faces first
  document.getElementById("winAmount").textContent = "";
  document.getElementById("lossAmount").textContent = "";

  // Decide which side shows the result
  const resultDisplayEl = resultIsHigh
    ? document.getElementById("winAmount")
    : document.getElementById("lossAmount");

  if (isWin) {
    resultDisplayEl.textContent = `+${amount}`;
    resultDisplayEl.style.color = '#33ff66';
    coin.classList.add("coin-glow-win");
    launchConfetti();
  } else {
    const lossAmount = parseFloat(betInput.value || "0").toFixed(3);
    resultDisplayEl.textContent = `-${parseFloat(lossAmount).toFixed(3)}`;
    resultDisplayEl.style.color = '#ff3333';
    coin.classList.add("coin-glow-loss");
  }

  // Remove glow after a few seconds
  setTimeout(() => {
    coin.classList.remove("coin-glow-win", "coin-glow-loss");
  }, 5000);
  }

  async function updateJackpotPool() {
  if (!readContract) return;
  try {
    const jackpot = await readContract.getJackpotPool();
    document.getElementById("jackpotAmount").textContent = parseFloat(ethers.formatEther(jackpot)).toFixed(6);

    const balance = await readContract.getBalance();
    document.getElementById("balanceAmount").textContent = parseFloat(ethers.formatEther(balance)).toFixed(2);
  } catch (err) {
    console.warn("Failed to update jackpot and balance", err);
  }
  }

  async function loadRecentFlips() {
  if (!readContract) return;

  try {
    if (!window.playerAddress && window.connected && window.signer) {
      window.playerAddress = await window.signer.getAddress();
    }
  } catch (err) {
    console.warn("Could not get player address", err);
  }

  let count = 0;
  try {
    const raw = await readContract.flipCount();
    count = Number(raw);
  } catch (err) {
    console.warn("Failed to fetch flip count", err);
    return;
  }

  // ✅ Clamp and validate count
  if (isNaN(count) || count <= 0) {
    document.getElementById("recentFlips").innerHTML = "<tr><td colspan='6'>No flips yet</td></tr>";
    document.getElementById("myRecentFlips").innerHTML = "<tr><td colspan='6'>No flips yet</td></tr>";
    return;
  }

  const safeCount = Math.min(count, 1000);

  let data;
  try {
    data = await readContract.getRecentFlips(BigInt(safeCount));
  } catch (err) {
    console.warn("getRecentFlips() failed", err);
    return;
  }

  const [ids, players, amounts, rolled, won, jackpot, guessHigh] = data;
  const validLength = Math.min(
    players.length,
    amounts.length,
    rolled.length,
    won.length,
    jackpot.length,
    guessHigh.length
  );

  recentFlips = players.slice(0, validLength).map((player, i) => {
    const bet = Number(ethers.formatEther(amounts[i]));
    const payout = won[i] ? (bet * 2 * 0.992).toFixed(3) : "-";

    return {
      id: ids[i],
      player,
      amount: payout,
      rolled: Number(rolled[i]),
      won: won[i],
      jackpot: jackpot[i],
      guessHigh: guessHigh[i],
      timestamp: Date.now()
    };
  });

  if (window.playerAddress) {
    myFlips = recentFlips.filter(f => f.player.toLowerCase() === window.playerAddress.toLowerCase());
  }
  renderRecentFlips();
  renderMyRecentFlips();
}

  function getSideIcon(isHigh) {
    const img = document.createElement("img");
    img.src = isHigh ? "/images/monad-colored.png" : "/images/monad-dark.png";
    img.alt = isHigh ? "Colored side" : "Dark side";
    img.style.width = "20px";
    img.style.height = "20px";
    return img;
  }
  
  function renderRecentFlips() { 
    const flipsTable = document.getElementById("recentFlips"); flipsTable.innerHTML = "";

const start = (currentRecentPage - 1) * flipsPerPage; const pageFlips = recentFlips.slice(start, start + flipsPerPage);

pageFlips.forEach(flip => { const row = document.createElement("tr"); row.className = flip.jackpot ? "jackpot-row new-flip" : "new-flip";

const guessIsHigh = flip.guessHigh;
const rolledIsHigh = flip.rolled >= 500;

const amountDisplay = flip.won
  ? `+${flip.amount} MON${flip.jackpot ? ' <span class="jackpot-icon">💎</span>' : ''}`
  : "-";

row.innerHTML = `
  <td><a href="https://testnet.monadscan.com/address/${flip.player}" target="_blank" class="addr-link">${shorten(flip.player)}</a></td>
  <td class="side-icon"></td>
  <td class="side-icon"></td>
  <td>${flip.rolled}</td>
  <td>${amountDisplay}</td>
`;

flipsTable.appendChild(row);
row.querySelectorAll(".side-icon")[0].appendChild(getSideIcon(guessIsHigh));
row.querySelectorAll(".side-icon")[1].appendChild(getSideIcon(rolledIsHigh));

});

renderPaginationControls("recentPagination", recentFlips.length, currentRecentPage, (page) => { currentRecentPage = page; renderRecentFlips(); }); }

function renderMyRecentFlips() {
  const flipsTable = document.getElementById("myRecentFlips"); flipsTable.innerHTML = "";

const start = (currentMyPage - 1) * flipsPerPage; const pageFlips = myFlips.slice(start, start + flipsPerPage);

pageFlips.forEach(flip => { const row = document.createElement("tr"); row.className = flip.jackpot ? "jackpot-row new-flip" : "new-flip";

const guessIsHigh = flip.guessHigh;
const rolledIsHigh = flip.rolled >= 500;

const amountDisplay = flip.won
  ? `+${flip.amount} MON${flip.jackpot ? ' <span class="jackpot-icon">💎</span>' : ''}`
  : "-";

row.innerHTML = `
  <td><a href="https://testnet.monadscan.com/address/${flip.player}" target="_blank" class="addr-link">${shorten(flip.player)}</a></td>
  <td class="side-icon"></td>
  <td class="side-icon"></td>
  <td>${flip.rolled}</td>
  <td>${amountDisplay}</td>
`;

flipsTable.appendChild(row);
row.querySelectorAll(".side-icon")[0].appendChild(getSideIcon(guessIsHigh));
row.querySelectorAll(".side-icon")[1].appendChild(getSideIcon(rolledIsHigh));

});

renderPaginationControls("myPagination", myFlips.length, currentMyPage, (page) => { currentMyPage = page; renderMyRecentFlips(); }); }

  function renderPaginationControls(containerId, totalItems, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const totalPages = Math.ceil(totalItems / flipsPerPage);
  if (totalPages <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "‹ Prev";
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => onPageChange(currentPage - 1);
  container.appendChild(prevBtn);

  const info = document.createElement("span");
  info.textContent = ` Page ${currentPage} of ${totalPages} `;
  container.appendChild(info);

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "Next ›";
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => onPageChange(currentPage + 1);
  container.appendChild(nextBtn);
  }

  async function loadMyStats(address) {
    try {
      const stats = await readContract.getMyStats(address);
      document.getElementById("flips").textContent = stats.totalFlips;
      document.getElementById("wins").textContent = stats.wins;
      document.getElementById("jackpots").textContent = stats.jackpots;
      document.getElementById("wagered").textContent = (Number(stats.wagered) / 1e18).toFixed(4);
      document.getElementById("paidOut").textContent = (Number(stats.paidOut) / 1e18).toFixed(4);
      document.getElementById("netGain").textContent = ((Number(stats.paidOut) - Number(stats.wagered)) / 1e18).toFixed(4);
    } catch (err) {
      console.warn("Failed to load player stats:", err.message);
    }
  }

  async function loadContractStats() {
    try {
      if (!readContract) return;
      const jackpot = await readContract.getJackpotPool();
      const balance = await readContract.getBalance();
      document.getElementById("jackpotAmount").textContent = parseFloat(ethers.formatEther(jackpot)).toFixed(6);
      document.getElementById("balanceAmount").textContent = parseFloat(ethers.formatEther(balance)).toFixed(2);
    } catch (err) {
      console.warn("Failed to load contract stats", err);
    }
  }

  function shorten(addr) {
    return addr.slice(0, 6) + "...";
  }

  function launchConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });

    myConfetti({
      particleCount: 400,
      spread: 160,
      origin: { y: 0.6 },
      colors: ['#9b4dff', '#ffffff', '#ff00cc', '#7f00ff'],
      scalar: 1.5,
    });
  }

function toggleConnectedUI(isConnected) {
  document.querySelectorAll("#connectShow").forEach(el => {
    el.style.display = isConnected ? "block" : "none";
  });
   if (isConnected) updatePythFee();
}

async function updatePythFee() {
  try {
    const feeWei = await readContract.getCurrentFee();
    const feeMON = ethers.formatEther(feeWei);
    const formatted = parseFloat(feeMON).toFixed(3);
    document.getElementById("pythFeeText").innerText = `Pyth Entropy fees: ${formatted} MON`;
  } catch (err) {
    console.error("Failed to fetch Pyth fee:", err);
    document.getElementById("pythFeeText").innerText = `Pyth Entropy fees: unavailable`;
  }
}

  window.loadMyStats = loadMyStats;
  window.loadRecentFlips = loadRecentFlips;
        
