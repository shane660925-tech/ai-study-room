// public/js/session-guard.js

async function checkCurrentSessionOrLogout() {
    const username = localStorage.getItem('studyVerseUser');
    const sessionId = localStorage.getItem('studyVerseSessionId');

    if (!username || !sessionId) {
        return true; 
    }

    try {
        const res = await fetch(
            `/api/auth/session-check?username=${encodeURIComponent(username)}&sessionId=${encodeURIComponent(sessionId)}`
        );

        const data = await res.json();

        if (!res.ok || !data.ok) {
            alert(data.message || '此帳號已在其他裝置登入，請重新登入');

            localStorage.removeItem('studyVerseUser');
            localStorage.removeItem('studyVerseSessionId');
            localStorage.removeItem('studyVerseRole');
            localStorage.removeItem('username');
            localStorage.removeItem('studyverse_username');
            localStorage.removeItem('currentUser');

            sessionStorage.clear();
            window.location.href = '/';
            return false;
        }

        return true;

    } catch (err) {
        console.error('Session guard 檢查失敗:', err);
        return true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    checkCurrentSessionOrLogout();

    setInterval(() => {
        checkCurrentSessionOrLogout();
    }, 30000);
});