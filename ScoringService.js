// ScoringService.js

/**
 * StudyVerse 計分與經驗值系統核心
 * 負責處理公式：EXP = (Σ(Ti * 10) * Mprog) * Mdevice * Mroom * Mteam - Ppenalty
 */
class ScoringService {
    // 1. 基礎常數設定
    static CONFIG = {
        BASE_EXP_PER_MIN: 10,
        DEVICE_MUL: {
            'ULTIMATE': 1.5, // PC視訊 + 手機翻轉
            'VISUAL': 1.0,   // 僅視訊
            'MOBILE': 0.5    // 僅手機
        },
        ROOM_MUL: {
            '2': 1.2,        // 沉浸室 (roomMode === '2')
            'simulated': 1.1, // 模擬教室
            '1': 1.0,        // 線上課程/一般
            'VIP': 0.8       // 特約教室
        }
    };

    // 2. 計算心流累進倍率 (分段加權)
    static calculateBaseExpWithFlow(minutes) {
        let totalBaseExp = 0;
        let maxFlowReached = 1.0;
        for (let i = 1; i <= minutes; i++) {
            let multiplier = 1.0;
            if (i > 90) multiplier = 2.0;      // 極限期
            else if (i > 60) multiplier = 1.5; // 心流期
            else if (i > 30) multiplier = 1.2; // 專注期
            
            if (multiplier > maxFlowReached) maxFlowReached = multiplier;
            totalBaseExp += (this.CONFIG.BASE_EXP_PER_MIN * multiplier);
        }
        return { totalBaseExp, maxFlowReached };
    }

    // 3. 獲取小隊倍率
    static getTeamMultiplier(teamSize, flippedCount) {
        if (teamSize >= 4 && flippedCount === 4) return 1.2; // 極限共鳴
        return 1 + (flippedCount * 0.05); // 每人 +5%
    }

    // 4. 最終 EXP 結算
    static calculateFinalExp(data) {
        const { 
            durationMin, 
            deviceMode, 
            roomMode, 
            teamSize, 
            flippedCount, 
            penaltyExp,
            violationDetails
        } = data;

        // A. 計算基礎累進 EXP
        const { totalBaseExp, maxFlowReached } = this.calculateBaseExpWithFlow(durationMin);

        // B. 獲取各項倍率
        const mDevice = this.CONFIG.DEVICE_MUL[deviceMode] || 1.0;
        const mRoom = this.CONFIG.ROOM_MUL[roomMode] || 1.0;
        const mTeam = this.getTeamMultiplier(teamSize || 1, flippedCount || 0);
        const combinedTeamMultiplier = Number((mDevice * mRoom * mTeam).toFixed(2));
        const extraPenaltyExp = Number(penaltyExp || 0);

        // B-2. 計算 pre-penalty 小計 EXP（用於百分比扣除）
        const subtotalExp = totalBaseExp * mDevice * mRoom * mTeam;

        // B-3. 根據 violationDetails 計算扣分細項（EXP 扣除 + 誠信分扣除）
        let totalExpPenalty = 0;
        let totalIntegrityPenalty = 0;
        const formattedPenaltyDetails = [];

        const details = (violationDetails && typeof violationDetails === 'object') ? violationDetails : {};
        for (const [reason, rawCount] of Object.entries(details)) {
            const count = Number(rawCount || 0);
            if (!Number.isFinite(count) || count <= 0) continue;

            let expDeduction = 0;
            let integrityDeduction = 0;

            if (reason.includes("使用手機") || reason.includes("出現手機")) {
                expDeduction = Math.floor(subtotalExp * 0.20) * count;
                integrityDeduction = 10 * count;
            } else if (reason.includes("手機翻開") || reason.includes("踢出")) {
                expDeduction = Math.floor(subtotalExp * 0.10) * count;
                integrityDeduction = 2 * count;
            } else if (reason.includes("趴睡")) {
                expDeduction = 500 * count;
                integrityDeduction = 5 * count;
            } else if (reason.includes("離座") || reason.includes("不在座位")) {
                expDeduction = 300 * count;
                integrityDeduction = 3 * count;
            } else if (reason.includes("切換分頁") || reason.includes("分心")) {
                expDeduction = 100 * count;
                integrityDeduction = 1 * count;
            } else {
                expDeduction = 200 * count;
                integrityDeduction = 1 * count;
            }

            totalExpPenalty += expDeduction;
            totalIntegrityPenalty += integrityDeduction;

            formattedPenaltyDetails.push({
                reason: reason,
                count: count,
                points: expDeduction,
                integrityPoints: integrityDeduction
            });
        }

        // C. 總公式結算
        const total = subtotalExp - totalExpPenalty;
        
        const finalExp = Math.max(0, Math.floor(total)); // 確保不為負數

        return {
            totalExp: finalExp,
            breakdown: {
                baseExp: totalBaseExp, // The progressive base EXP calculated from time
                multipliers: {
                    flow: maxFlowReached, // The highest flow multiplier reached (e.g., 1.0, 1.2, 1.5, or 2.0 based on duration)
                    team: combinedTeamMultiplier // The combined multiplier of device, room, and team
                },
                penalty: totalExpPenalty,
                penaltyDetails: formattedPenaltyDetails,
                integrityPenalty: totalIntegrityPenalty
            }
        };
    }
}

module.exports = ScoringService;