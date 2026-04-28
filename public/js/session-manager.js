/**
 * Session Manager - 專門處理專注結算、產生報告與 API 儲存
 * [V2.3.4 修改] 修正標籤比對邏輯，嚴格區分「畫面手機」與「手機中斷」，並確保明細正確顯示
 */

function generateFinalReport(seconds) {
    const mins = Math.floor(seconds / 60);
    const baseExp = mins * 10; 
    
    let integrityScore = 100;    
    let expDeductionFixed = 0;   
    let expDeductionPercent = 0; 

    // 1. 標準化計數器
    let counts = {
        phoneInFrame: 0,       // 畫面出現手機 (扣分重)
        phoneFlipInterrupt: 0, // 手機翻開/連動中斷 (扣分輕)
        sleep: 0,              
        leave: 0,              
        distract: 0,           
        other: []              // 捕捉未分類標籤
    };

    // 確保抓得到資料，若無則預設為空物件
    const violations = window.violationDetails || {};

    // 2. 嚴格比對與分類邏輯
    Object.entries(violations).forEach(([reason, count]) => {
        if (count <= 0) return;

        const r = reason.toUpperCase(); 

        // A. 優先判斷「手機連動中斷/翻開」 (這類通常包含 中斷、翻、踢出、DISCONNECT、INTERRUPT)
        if (r.includes("中斷") || r.includes("踢出") || r.includes("翻") || r.includes("INTERRUPT") || r.includes("FLIP") || r.includes("DISCONNECT")) {
            counts.phoneFlipInterrupt += count;
        } 
        // B. 判斷「畫面出現手機」 (這類包含 手機、畫面、偵測，但排除掉上方已判斷過的中斷類)
        else if (r.includes("手機") || r.includes("PHONE") || r.includes("MOBILE") || r.includes("畫面") || r.includes("偵測")) {
            counts.phoneInFrame += count;
        }
        else if (r.includes("趴睡") || r.includes("SLEEP")) {
            counts.sleep += count;
        }
        else if (r.includes("離座") || r.includes("LEAVE") || r.includes("LEFT")) {
            counts.leave += count;
        }
        else if (r.includes("分心") || r.includes("分頁") || r.includes("DISTRACT") || r.includes("TAB") || r.includes("切換")) {
            counts.distract += count;
        }
        else {
            counts.other.push({ name: reason, count: count });
        }
    });

    // 3. 執行扣分運算 (依照你的標準)
    // 畫面出現手機：誠信-10 / EXP -20%
    if (counts.phoneInFrame > 0) { 
        integrityScore -= (10 * counts.phoneInFrame); 
        expDeductionPercent += (0.20 * counts.phoneInFrame); 
    }
    // 手機翻開中斷：誠信-2 / EXP -10%
    if (counts.phoneFlipInterrupt > 0) { 
        integrityScore -= (2 * counts.phoneFlipInterrupt); 
        expDeductionPercent += (0.10 * counts.phoneFlipInterrupt); 
    }
    if (counts.sleep > 0) { integrityScore -= (5 * counts.sleep); expDeductionFixed += (500 * counts.sleep); }
    if (counts.leave > 0) { integrityScore -= (3 * counts.leave); expDeductionFixed += (300 * counts.leave); }
    if (counts.distract > 0) { integrityScore -= (1 * counts.distract); expDeductionFixed += (100 * counts.distract); }

    // 未分類違規
    counts.other.forEach(item => {
        integrityScore -= (1 * item.count); 
        expDeductionFixed += (50 * item.count);
    });

    // 計算最終數值
    integrityScore = Math.max(0, integrityScore);
    let finalExp = Math.floor((baseExp - expDeductionFixed) * (1 - Math.min(1, expDeductionPercent)));
    finalExp = Math.max(0, finalExp);

    // 4. 重建明細文字 (這是顯示在結算畫面上的明細)
    let detailsArr = [];
    if (counts.phoneInFrame > 0) detailsArr.push(`   🚫 畫面出現手機 x${counts.phoneInFrame} (扣誠信10 / EXP 20%)`);
    if (counts.phoneFlipInterrupt > 0) detailsArr.push(`   📱 手機連動中斷/翻開 x${counts.phoneFlipInterrupt} (扣誠信2 / EXP 10%)`);
    if (counts.sleep > 0) detailsArr.push(`   💤 偵測趴睡 x${counts.sleep}`);
    if (counts.leave > 0) detailsArr.push(`   🪑 偵測離座 x${counts.leave}`);
    if (counts.distract > 0) detailsArr.push(`   ⚠️ 分心或切換分頁 x${counts.distract}`);
    
    counts.other.forEach(item => {
        detailsArr.push(`   ❓ 其他違規 [${item.name}] x${item.count}`);
    });

    let details = detailsArr.length > 0 ? detailsArr.join("\n") : "   無違規紀錄，表現優異！✨";

    // 產生評價
    let comment = "";
    if (integrityScore >= 90) comment = "太不可思議了！你的專注力簡直就像是黑洞，AI 老師為你感到驕傲！👑";
    else if (integrityScore >= 70) comment = "做得好！雖然中間有一點點小分神，但你調整的速度非常快處理得很好。💪";
    else if (integrityScore >= 50) comment = "今天辛苦了！學習的路途難免有分心的時候，休息一下再出發吧。🌿";
    else comment = "感覺你今天的心情有點浮躁呢？沒關係，調整好狀態，下次我們再一起努力。🔥";

    return {
        integrity: integrityScore,
        score: integrityScore,     
        exp: finalExp,             
        details: details,
        comment: comment,
        totalViolations: window.totalViolationCount || 0
    };
}

window.endSession = async function() {
    const startTime = window.sessionStartTime || Date.now();
    let elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    
    if (window.StudyTimer && window.StudyTimer.totalSeconds > 0) {
        elapsedSeconds = window.StudyTimer.totalSeconds - window.StudyTimer.remainingSeconds;
    }
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const minRequired = 20;

    const report = generateFinalReport(elapsedSeconds);

    if (elapsedMinutes < minRequired && window.currentRoomMode === 'simulated') {
        const confirmLeave = confirm(`⚠️ 專注未滿 ${minRequired} 分鐘！\n現在離開將會「加重扣分」並留下記錄。\n\n確定要早退嗎？`);
        if (!confirmLeave) return;
        if(window.appSocket) window.appSocket.emit("early_leave", { name: window.myUsername, elapsed: elapsedMinutes, penalty: true });
    }

    if (window.appSocket) {
        const reportData = {
            name: window.myUsername,
            score: report.score,
            duration: elapsedSeconds,
            violationCount: window.totalViolationCount,
            details: window.violationDetails,
            aiComment: report.comment,
            timestamp: new Date().toLocaleTimeString()
        };

        window.appSocket.emit("submit_final_report", reportData);

        if (window.currentRoomMode === 'tutor') {
            window.appSocket.emit("tutor_receive_report", reportData);
        }

        window.appSocket.emit('report_session_done', {
            name: window.myUsername,
            goal: document.getElementById('inputGoal')?.value || "自主學習",
            duration: elapsedMinutes,
            comment: report.comment,
            integrity: report.integrity
        });
    }

    const focusMinutes = Math.floor(elapsedSeconds / 60);
    const pomodoros = Math.floor(focusMinutes / 25); 
    const isDeepFocus = focusMinutes >= 120; 

    let gains = (pomodoros * 2) + (isDeepFocus ? 5 : 0);
    let penalties = window.totalViolationCount * 5; 
    
    let creditDelta = gains - penalties;
    if (creditDelta > 15) creditDelta = 15;
    if (creditDelta < -20) creditDelta = -20;

    if (focusMinutes >= 240 && window.appSocket) {
        window.appSocket.emit('community_event', { type: 'ACHIEVE', message: `恭喜 ${window.myUsername} 解鎖「鋼鐵意志」勳章！(單次專注4小時)` });
    } else if (focusMinutes >= 120 && window.appSocket) {
        window.appSocket.emit('community_event', { type: 'ACHIEVE', message: `恭喜 ${window.myUsername} 解鎖「深度潛航」勳章！(單次專注2小時)` });
    }

    try {
        const response = await fetch('/api/save-focus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: window.myUsername,
                score: report.score,
                focusSeconds: elapsedSeconds,
                violationDetails: window.violationDetails,
                comment: report.comment,
                creditDelta: creditDelta,
                deviceMode: window.isPhoneFlipped ? 'ULTIMATE' : 'VISUAL',
                roomType: window.currentRoomMode,
                integrityScore: report.integrityScore, // 新增此行：將本次誠信分傳給後端
                teamSize: window.remoteUsers ? window.remoteUsers.length + 1 : 1,
                flippedCount: window.remoteUsers ? window.remoteUsers.filter(u => u.isFlipped).length + (window.isPhoneFlipped ? 1 : 0) : (window.isPhoneFlipped ? 1 : 0)
            })
        });

        const result = await response.json();

        if (response.ok) {
            if (window.renderSummaryModal) {
                window.renderSummaryModal(result, report, elapsedMinutes);
            }
        }

    } catch (err) { 
        console.error("存檔失敗:", err); 
    }
    
    sessionStorage.removeItem('mobileLinked');
    localStorage.removeItem('mobileLinked');

    if(window.appSocket && window.appSocket.connected) {
        window.appSocket.emit("update_status", { status: "IDLE", name: window.myUsername, isFlipped: false });
        window.appSocket.emit('mobile_sync_update', { type: 'FORCE_DISCONNECT', studentName: window.myUsername });

        if (window.myUsername) {
            window.appSocket.emit('mobile_sync', { 
                username: window.myUsername, 
                connected: false, 
                isFlipped: false 
            });
        }

        await new Promise(resolve => setTimeout(resolve, 200));
        window.appSocket.disconnect();
    } else if (window.appSocket) {
        window.appSocket.disconnect();
    }
};