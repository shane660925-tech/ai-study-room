/**
 * 純拆分：專注計時模組 (room-timer.js)
 */
window.RoomTimer = (function() {
    let totalSeconds = 0;
    let timerInterval = null;

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
    }

    function updateDisplay() {
        const timeEl = document.getElementById('timeLeftDisplay');
        if (timeEl) timeEl.innerText = formatTime(totalSeconds);
    }

    function tick() {
        if (totalSeconds > 0) {
            totalSeconds--;
            updateDisplay();
        } else {
            clearInterval(timerInterval);
            // 觸發你原本的時間到期事件
        }
    }

    function start(minutes) {
        if (!minutes || minutes <= 0) return;
        totalSeconds = minutes * 60;
        updateDisplay();
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = setInterval(tick, 1000);
    }

    return { start };
})();