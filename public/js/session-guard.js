// public/js/session-guard.js

(function () {
    const FORCE_LOGOUT_MESSAGE = '此帳號已在其他裝置登入，請重新登入';

    function normalizeUsername(value) {
        return String(value || '')
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeSessionId(value) {
        return String(value || '')
            .replace(/[\r\n\t\s]+/g, '')
            .trim();
    }

    function getCurrentSessionIdentity() {
        const rawUsername = localStorage.getItem('studyVerseUser');
        const rawSessionId = localStorage.getItem('studyVerseSessionId');

        const username = normalizeUsername(rawUsername);
        const sessionId = normalizeSessionId(rawSessionId);

        if (rawUsername !== username) {
            localStorage.setItem('studyVerseUser', username);
        }

        if (rawSessionId !== sessionId) {
            localStorage.setItem('studyVerseSessionId', sessionId);
        }

        return {
            username,
            sessionId
        };
    }

    function clearLoginStorage() {
        localStorage.removeItem('studyVerseUser');
        localStorage.removeItem('studyVerseSessionId');
        localStorage.removeItem('studyVerseRole');
        localStorage.removeItem('username');
        localStorage.removeItem('studyverse_username');
        localStorage.removeItem('currentUser');

        sessionStorage.clear();
    }

    function forceLogoutToHome(message) {
        if (window.__studyVerseForceLoggingOut) return;
        window.__studyVerseForceLoggingOut = true;

        alert(message || FORCE_LOGOUT_MESSAGE);

        try {
            const activeSocket = window.socket || window.appSocket;

            if (activeSocket && activeSocket.connected) {
                activeSocket.disconnect();
            }
        } catch (err) {
            console.warn('強制登出時關閉 socket 失敗:', err);
        }

        clearLoginStorage();
        window.location.href = '/';
    }

    async function checkCurrentSessionOrLogout() {
        const { username, sessionId } = getCurrentSessionIdentity();

        if (!username || !sessionId) {
            return true;
        }

        try {
            const res = await fetch(
                `/api/auth/session-check?username=${encodeURIComponent(username)}&sessionId=${encodeURIComponent(sessionId)}`
            );

            const data = await res.json();

            if (!res.ok || !data.ok) {
                forceLogoutToHome(data.message || FORCE_LOGOUT_MESSAGE);
                return false;
            }

            return true;

        } catch (err) {
            console.error('Session guard 檢查失敗:', err);

            // 網路短暫錯誤不要直接登出，避免誤踢正常學生
            return true;
        }
    }

    function bindSocketSessionGuard(targetSocket) {
        if (!targetSocket) return false;

        const { username, sessionId } = getCurrentSessionIdentity();

        if (!username || !sessionId) {
            return false;
        }

        if (!targetSocket.__studyVerseForceLogoutBound) {
            targetSocket.__studyVerseForceLogoutBound = true;

            targetSocket.on('force_logout', (data) => {
                forceLogoutToHome(
                    data?.reason ||
                    data?.message ||
                    FORCE_LOGOUT_MESSAGE
                );
            });
        }

        const authKey = `${username}:${sessionId}`;

        function emitAuthSession() {
            if (targetSocket.__studyVerseAuthSessionKey === authKey) {
                return;
            }

            targetSocket.__studyVerseAuthSessionKey = authKey;

            targetSocket.emit('auth_session', {
                username,
                sessionId
            });

            console.log('[SessionGuard] 已送出 socket auth_session:', username);
        }

        if (targetSocket.connected) {
            emitAuthSession();
        } else {
            targetSocket.once('connect', emitAuthSession);
        }

        return true;
    }

    function attachSocketSessionGuard() {
        // 優先沿用頁面既有 socket，避免重開多條連線
        if (window.socket) {
            return bindSocketSessionGuard(window.socket);
        }

        if (window.appSocket) {
            return bindSocketSessionGuard(window.appSocket);
        }

        // tutor-room.html 有先載入 socket.io，所以這裡可以建立共用 socket
        // tutor-client.js 會沿用 window.socket，不會再重開
        if (typeof window.io === 'function') {
            window.socket = window.socket || window.io();
            return bindSocketSessionGuard(window.socket);
        }

        return false;
    }

    window.StudyVerseSessionGuard = {
        checkCurrentSessionOrLogout,
        attachSocketSessionGuard,
        forceLogoutToHome
    };

    document.addEventListener('DOMContentLoaded', () => {
        checkCurrentSessionOrLogout();
        attachSocketSessionGuard();

        // 有些頁面 socket 比 session-guard 晚建立，補幾次即可
        let retryCount = 0;
        const retryTimer = setInterval(() => {
            retryCount++;

            const attached = attachSocketSessionGuard();

            if (attached || retryCount >= 10) {
                clearInterval(retryTimer);
            }
        }, 500);

        setInterval(() => {
            checkCurrentSessionOrLogout();
            attachSocketSessionGuard();
        }, 30000);
    });
})();