/**
 * Socket Events - 專門處理所有來自伺服器的 Socket 廣播與通訊事件
 */
window.setupSocketEvents = function(socket, myUsername) {
    if (!socket) {
        console.warn("[Socket] 找不到 Socket 實例，無法註冊事件。");
        return;
    }

    console.log("✅ Socket 事件監聽模組已成功啟動");

    // 1. 連線成功處理
    socket.on('connect', () => {
        console.log("✅ Socket 已連線，正在登錄身分...");
        const urlParams = new URLSearchParams(window.location.search);
const themeSlug = urlParams.get('theme');

if (themeSlug) {
    window.currentRoomMode = `theme:${themeSlug}`;
}

const finalRoomMode =
    window.currentRoomMode ||
    window.roomMode ||
    "managed";

console.log("🧪 Socket connect roomMode =", finalRoomMode);

socket.emit("update_status", { 
    status: window.myStatus || "FOCUSED", 
    name: myUsername, 
    isFlipped: window.isPhoneFlipped,
    isCaptain: window.isAuditMode,
    roomMode: finalRoomMode
});
    });

    // 2. 手機同步更新
    socket.on('mobile_sync_update', (data) => {
        if (data.studentName === myUsername) {
            if (data.type === 'FLIP_WARNING') {
                window.isPhoneCurrentlyUnflipped = true;
            } else if (data.type === 'FLIP_COMPLETED') {
                window.isPhoneCurrentlyUnflipped = false;
                if (window.localFlipKickTimer) clearTimeout(window.localFlipKickTimer);
            }

            if (window.isAIPaused) return;

            if (data.type === 'FLIP_WARNING') {
                window.isFlipWarningActive = true;
                window.myStatus = "DISTRACTED";
                socket.emit("update_status", { status: "DISTRACTED", name: myUsername, isFlipped: false });
                
                if (!window.alertAudio) {
                    window.alertAudio = new Audio('https://www.myinstants.com/media/sounds/iphone-emergency-alert.mp3');
                    window.alertAudio.loop = true;
                }
                window.alertAudio.play().catch(e => console.log("音效播放受阻", e));
                
                if (window.RoomUI) window.RoomUI.showWarning('PHONE_FLIP', 5);
                if (window.showFlipCountdownModal) window.showFlipCountdownModal();

            } else if (data.type === 'FLIP_COMPLETED') {
                if (window.alertAudio) {
                    window.alertAudio.pause();
                    window.alertAudio.currentTime = 0;
                }

                if (window.isFlipWarningActive) {
                    socket.emit('violation', {
                        name: myUsername,
                        type: '📱 翻開手機 (已於5秒內及時蓋回)',
                        image: null 
                    });
                    window.totalViolationCount++;
                    window.violationDetails["📱 使用手機"] = (window.violationDetails["📱 使用手機"] || 0) + 1;
                }

                window.isFlipWarningActive = false;
                window.myStatus = "FOCUSED";
                
                if (window.RoomUI) window.RoomUI.hideWarning();
                if (window.hideFlipCountdownModal) window.hideFlipCountdownModal();

                socket.emit("update_status", { status: "FOCUSED", name: myUsername, isFlipped: true });
            }
        }
    });

    // 3. 翻轉失敗 (被踢出)
    socket.on('flip_failed', async (data) => {
        const targetName = data.name || data.username || "某位同學";

        if (targetName === myUsername && sessionStorage.getItem('mobileLinked') === 'true') {
            if (window.isKickingOut) return; 
            window.isKickingOut = true; 

            if (window.isAIPaused) {
                window.isKickingOut = false;
                return; 
            }

            window.isPhoneFlipped = false; 
            if (window.alertAudio) {
                window.alertAudio.pause();
                window.alertAudio.currentTime = 0;
            }
            if (window.RoomUI) window.RoomUI.hideWarning();
            if (window.hideFlipCountdownModal) window.hideFlipCountdownModal();
            
            window.totalViolationCount++;
            window.violationDetails["📱 手機翻轉中斷"] = (window.violationDetails["📱 手機翻轉中斷"] || 0) + 1;
            
            setTimeout(async () => {
                alert("🚨 您已違反翻轉專注規則，系統即將為您結算專注數據並通報導師！");
                if (window.endSession) await window.endSession();
            }, 100);
            
        } else if (targetName !== myUsername) {
            if (window.showPublicShamingToast) window.showPublicShamingToast(targetName);
            const bbContent = document.getElementById('blackboardContent'); 
            if (bbContent) {
                bbContent.innerText = `🚨 系統廣播：${targetName} 因翻開手機被強制踢出教室！`;
                bbContent.classList.add('text-red-400');
                setTimeout(() => bbContent.classList.remove('text-red-400'), 4000);
            }
        }
    });
    
    // 4. 導師指令
    socket.on('tutor_command', async (data) => {
        if (data.command === 'course_ended') {
            if (!window.hasAutoEnded) {
                window.hasAutoEnded = true; 
                alert("🎉 本次特約教室的所有課程已結束！即將為您產生專注結算報告...");
                if (window.endSession) await window.endSession();
            }
        }
    });
    
    // 5. 強制狀態同步
    socket.on('force_status_sync', (data) => {
        if (data.isFlipped !== undefined) {
            window.isPhoneFlipped = data.isFlipped;
        }
    });

    // 6. 隊長更新
    socket.on('team_leader_update', (data) => {
        window.currentTeamLeader = data.leader;
        if (typeof window.updateLeaderUI === 'function') {
            window.updateLeaderUI();
        }
    });

    // 7. 入隊請求
    socket.on("team_join_request", (data) => {
        if (window.addJoinRequest) window.addJoinRequest(data);
    });

    // 8. 更新排行榜與遠端用戶
    socket.on("update_rank", (users) => {
        window.remoteUsers = users; 
        if (window.renderRankAndUsers) {
            window.renderRankAndUsers(users, myUsername, window.currentTeamLeader);
        }
    });

    // 9. 管理員動作 (叫醒、黑板)
    socket.on("admin_action", (data) => {
        if (data.type === 'WAKEUP' && data.target === myUsername) {
            const audio = new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
            audio.play().catch(e => console.log("音效播放受阻"));
            
            const violationModal = document.getElementById("violation-modal");
            const violationMsg = document.getElementById("violation-msg");
            
            if (violationModal) {
                violationModal.classList.remove("hidden");
                violationModal.classList.add("flex");
                if (violationMsg) violationMsg.innerText = data.message || "老師正在關注你！請立刻回到專注狀態！";
            }
        }
        if (data.type === 'BLACKBOARD') {
            const bbContent = document.getElementById('blackboardContent'); 
            if (bbContent) {
                bbContent.innerText = data.content;
                bbContent.classList.add('text-yellow-400');
                setTimeout(() => bbContent.classList.remove('text-yellow-400'), 2000);
            }
        }
    });
};