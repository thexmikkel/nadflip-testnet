// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.18;

import { IEntropy } from "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import { IEntropyConsumer } from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";


contract Nadflip is IEntropyConsumer {

    address public owner; 
    address public devWallet; 
    IEntropy entropy;
    address provider;

    uint256 public minBet = 0.1 ether;
    uint256 public maxBet = 100 ether;
    uint256 public devFee = 20; // 0.2%
    uint256 public houseEdge = 80; // 0.8%

    uint256 public jackpotPool;
    uint256 public constant JACKPOT_NUMBER = 888;

    uint256 public totalWagered;
    uint256 public totalPaidOut;
    uint256 public totalJackpots;
    uint256 public uniquePlayers;

    uint64[] public allSequenceNumbers;

    struct PlayerStats {
        uint256 totalFlips;
        uint256 wins;
        uint256 jackpots;
        uint256 wagered;
        uint256 paidOut;
    }

    struct Flip {
        address player;
        uint88 amount;
        uint32 rolled;
        uint32 timestamp;
        bool won;
        bool jackpot;
        bool guessHigh;
    }

    struct JackpotWin {
        address player;
        uint256 amount;
        uint32 timestamp;
    }
    JackpotWin[] public jackpotHistory;

    struct PendingFlip {
        address player;
        uint256 amount;
        bool guessHigh;
        uint32 timestamp;
    }

    mapping(uint256 => PendingFlip) public pendingFlips;
    Flip[] public flips;
    mapping(address => PlayerStats) public stats;
    mapping(address => bool) public seenBefore;

    event FlipResult(address indexed player, uint256 rolledNumber, bool won, bool jackpot, uint256 amount, bool guessHigh);
    event Received(address indexed sender, uint256 amount);
    event JackpotFunded(address indexed sender, uint256 amount, string message);
    event FlipRefunded(address indexed player, uint256 requestId, uint256 amount);
    event FlipPending(address indexed player, uint256 requestId, uint256 amount, bool guessHigh, uint32 timestamp);
    event EntropyUpdated(address newEntropy);
    event ProviderUpdated(address newProvider);

    constructor(address _devWallet, address _entropy, address _provider) {
    owner = msg.sender;
    devWallet = _devWallet;
    entropy = IEntropy(_entropy);
    provider = _provider;
}

    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }


    function flipCount() external view returns (uint256) {
        return flips.length;
    }

    function flipCoin(bool guessHigh) external payable {
        uint128 fee = entropy.getFee(provider);
        require(msg.value >= fee, "Insufficient fee");

        uint256 netBet = msg.value - fee;

        require(netBet >= minBet && netBet <= maxBet, "Invalid bet amount");

        // Check contract has enough to pay out potential win + jackpot
        uint256 payout = (netBet * 2 * (10000 - devFee - houseEdge)) / 10000;
        require(address(this).balance >= payout + jackpotPool, "Insufficient funds");

        // Request randomness
        uint64 sequenceNumber = entropy.requestWithCallback{ value: fee }(
            provider,
            bytes32(0)
        );

        // Store flip using sequenceNumber and net bet amount
        pendingFlips[sequenceNumber] = PendingFlip({
            player: msg.sender,
            amount: netBet,
            guessHigh: guessHigh,
            timestamp: uint32(block.timestamp)
        });
        allSequenceNumbers.push(sequenceNumber);
        emit FlipPending(msg.sender, sequenceNumber, netBet, guessHigh, uint32(block.timestamp));
    }

    function entropyCallback(
        uint64 sequence,
        address, // _provider can be ignored
        bytes32 randomNumber
    ) internal override {
        uint256 rolled = (uint256(randomNumber) % 999) + 1;
        _finalizeFlip(sequence, rolled);
    }


    function _finalizeFlip(uint256 requestId, uint256 rolled) internal {
        PendingFlip memory flip = pendingFlips[requestId];
        require(flip.player != address(0), "Invalid flip");

        bool isJackpot = rolled == JACKPOT_NUMBER;
        bool won = (flip.guessHigh && rolled >= 500) || (!flip.guessHigh && rolled < 500);

        PlayerStats storage s = stats[flip.player];
        if (isJackpot) s.jackpots++;

        uint256 toJackpot = (flip.amount * houseEdge) / 10000;
        uint256 devCut = (flip.amount * devFee) / 10000;
        jackpotPool += toJackpot;
        if (devCut > 0) payable(devWallet).transfer(devCut);

        uint256 payout = (flip.amount * 2 * (10000 - devFee - houseEdge)) / 10000;
        uint256 actualPayout = won ? payout : 0;

        if (isJackpot && jackpotPool > 0) {
            actualPayout += jackpotPool;
            jackpotPool = 0;
            jackpotHistory.push(JackpotWin({
                player: flip.player,
                amount: actualPayout,
                timestamp: uint32(block.timestamp)
            }));
        }

        if (actualPayout > 0) {
            payable(flip.player).transfer(actualPayout);
        }

        s.totalFlips++;
        s.wagered += flip.amount;
        if (won) s.wins++;
        if (won) s.paidOut += actualPayout;

        totalWagered += flip.amount;
        if (won) totalPaidOut += actualPayout;
        if (isJackpot) totalJackpots++;

        if (!seenBefore[flip.player]) {
            seenBefore[flip.player] = true;
            uniquePlayers++;
        }

        flips.push(Flip({
            player: flip.player,
            amount: uint88(flip.amount),
            rolled: uint32(rolled),
            timestamp: uint32(block.timestamp),
            won: won,
            jackpot: isJackpot,
            guessHigh: flip.guessHigh
        }));

        emit FlipResult(flip.player, rolled, won, isJackpot, actualPayout, flip.guessHigh);

        delete pendingFlips[requestId];
    }

    function refundUnfulfilledFlip(uint256 requestId) external {
        PendingFlip memory flip = pendingFlips[requestId];
        require(flip.player == msg.sender, "Not your flip");
        require(flip.amount > 0, "Already fulfilled or refunded");
        require(block.timestamp > flip.timestamp + 15 minutes, "Wait before refund");

        delete pendingFlips[requestId];
        payable(msg.sender).transfer(flip.amount);
        emit FlipRefunded(msg.sender, requestId, flip.amount);
    }

    function getAllPendingFlips() external view returns (uint64[] memory ids) {
        uint count = 0;
        for (uint i = 0; i < allSequenceNumbers.length; i++) {
            if (pendingFlips[allSequenceNumbers[i]].amount > 0) count++;
        }

        ids = new uint64[](count);
        uint idx = 0;
        for (uint i = 0; i < allSequenceNumbers.length; i++) {
            uint64 seq = allSequenceNumbers[i];
            if (pendingFlips[seq].amount > 0) {
                ids[idx++] = seq;
            }
        }
    }


    function getRefundableFlips() external view returns (uint64[] memory) {
        uint count = 0;
        for (uint i = 0; i < allSequenceNumbers.length; i++) {
            uint64 seq = allSequenceNumbers[i];
            if (
                pendingFlips[seq].amount > 0 &&
                block.timestamp > pendingFlips[seq].timestamp + 15 minutes
            ) {
                count++;
            }
        }

        uint64[] memory refundable = new uint64[](count);
        uint idx = 0;
        for (uint i = 0; i < allSequenceNumbers.length; i++) {
            uint64 seq = allSequenceNumbers[i];
            if (
                pendingFlips[seq].amount > 0 &&
                block.timestamp > pendingFlips[seq].timestamp + 15 minutes
            ) {
                refundable[idx++] = seq;
            }
        }
        return refundable;
    }


    function getMyStats(address player) external view returns (
        uint256 totalFlips,
        uint256 wins,
        uint256 jackpots,
        uint256 wagered,
        uint256 paidOut
    ) {
        PlayerStats memory s = stats[player];
        return (s.totalFlips, s.wins, s.jackpots, s.wagered, s.paidOut);
    }

    function getRecentFlips(uint count) external view returns (
        uint256[] memory ids,
        address[] memory players,
        uint88[] memory amounts,
        uint32[] memory rolled,
        bool[] memory won,
        bool[] memory jackpot,
        bool[] memory guessHigh
    ) {
        uint total = flips.length;
        if (count > total) count = total;

        ids = new uint256[](count);
        players = new address[](count);
        amounts = new uint88[](count);
        rolled = new uint32[](count);
        won = new bool[](count);
        jackpot = new bool[](count);
        guessHigh = new bool[](count);

        for (uint i = 0; i < count; i++) {
            uint index = total - 1 - i;
            Flip memory f = flips[index];
            ids[i] = index;
            players[i] = f.player;
            amounts[i] = f.amount;
            rolled[i] = f.rolled;
            won[i] = f.won;
            jackpot[i] = f.jackpot;
            guessHigh[i] = f.guessHigh;
        }
    }

    function getRecentFlipsCount() external view returns (uint256) {
        return flips.length < 250 ? flips.length : 250;
    }

    function getRecentJackpotWins(uint count) external view returns (
        address[] memory players,
        uint256[] memory amounts,
        uint32[] memory timestamps
    ) {
        uint total = jackpotHistory.length;
        if (count > total) count = total;

        players = new address[](count);
        amounts = new uint256[](count);
        timestamps = new uint32[](count);

        for (uint i = 0; i < count; i++) {
            uint index = total - 1 - i;
            JackpotWin memory j = jackpotHistory[index];
            players[i] = j.player;
            amounts[i] = j.amount;
            timestamps[i] = j.timestamp;
        }
    }

    function adminRefund(address to, uint256 requestId) external {
        require(msg.sender == owner, "Not owner");
        PendingFlip memory flip = pendingFlips[requestId];
        require(flip.amount > 0, "Already refunded");
        require(flip.player == to, "Not matching");

        delete pendingFlips[requestId];
        payable(to).transfer(flip.amount);
        emit FlipRefunded(to, requestId, flip.amount);
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "Not owner");
        require(amount <= address(this).balance, "Too much");
        payable(owner).transfer(amount);
    }

    function fundJackpotWithMessage(string calldata message) external payable {
        require(msg.value > 0, "Must send MON");
        jackpotPool += msg.value;
        emit JackpotFunded(msg.sender, msg.value, message);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getJackpotPool() external view returns (uint256) {
        return jackpotPool;
    }

    function getCurrentFee() external view returns (uint128) {
        return entropy.getFee(provider);
    }

    function setEntropy(address _entropy) external {
        require(msg.sender == owner, "Not owner");
        entropy = IEntropy(_entropy);
        emit EntropyUpdated(_entropy);
    }

    function setProvider(address _provider) external {
        require(msg.sender == owner, "Not owner");
        provider = _provider;
        emit ProviderUpdated(_provider);
    }

    function setBetRange(uint256 _min, uint256 _max) external {
        require(msg.sender == owner, "Not owner");
        minBet = _min;
        maxBet = _max;
    }

    function setFees(uint256 _devFee, uint256 _houseEdge) external {
        require(msg.sender == owner, "Not owner");
        require(_devFee + _houseEdge <= 10000, "Too high");
        devFee = _devFee;
        houseEdge = _houseEdge;
    }

    function setDevWallet(address _wallet) external {
        require(msg.sender == owner, "Not owner");
        devWallet = _wallet;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

}
