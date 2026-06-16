/**
 * Demo Flip Socket
 * 只給免註冊體驗頁使用。
 *
 * 安全原則：
 * - 不寫 Supabase
 * - 不接正式教室
 * - 不使用正式 join_room / update_status / mobile_sync_update / flip_failed
 * - 只處理 demo_flip_* 事件
 */

module.exports = function registerDemoFlipSocket(io) {
    const demoRooms = new Map();

    function makeDemoRoomId() {
        return `DF-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    }

    function safeAck(ack, payload) {
        if (typeof ack === 'function') {
            ack(payload);
        }
    }

    function getPublicRoom(room) {
        if (!room) return null;

        return {
            roomId: room.roomId,
            desktopConnected: !!room.desktopSocketId,
            phoneConnected: !!room.phoneSocketId,
            phoneState: room.phoneState || 'waiting',
            createdAt: room.createdAt,
            updatedAt: room.updatedAt
        };
    }

    function notifyDesktop(roomId, eventName, payload) {
        const room = demoRooms.get(roomId);
        if (!room || !room.desktopSocketId) return;

        io.to(room.desktopSocketId).emit(eventName, {
            roomId,
            ...payload
        });
    }

    function cleanupExpiredRooms() {
        const now = Date.now();
        const maxAgeMs = 30 * 60 * 1000;

        for (const [roomId, room] of demoRooms.entries()) {
            if (now - room.updatedAt > maxAgeMs) {
                demoRooms.delete(roomId);
            }
        }
    }

    setInterval(cleanupExpiredRooms, 5 * 60 * 1000);

    io.on('connection', (socket) => {
        /**
         * 電腦端建立 demo 房間
         */
        socket.on('demo_flip_create_room', (_payload, ack) => {
            const roomId = makeDemoRoomId();
            const socketRoom = `demo_flip:${roomId}`;

            socket.join(socketRoom);

            const room = {
                roomId,
                socketRoom,
                desktopSocketId: socket.id,
                phoneSocketId: null,
                phoneState: 'waiting',
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            demoRooms.set(roomId, room);

            console.log('[DemoFlip] desktop created room:', roomId);

            safeAck(ack, {
                success: true,
                room: getPublicRoom(room)
            });
        });

        /**
         * 手機端掃 QR Code 後加入 demo 房間
         */
        socket.on('demo_flip_join_room', (payload, ack) => {
            const roomId = String(payload?.roomId || '').trim();
            const room = demoRooms.get(roomId);

            if (!room) {
                return safeAck(ack, {
                    success: false,
                    error: '找不到此體驗房間，請重新掃描 QR Code'
                });
            }

            socket.join(room.socketRoom);

            room.phoneSocketId = socket.id;
            room.phoneState = 'connected';
            room.updatedAt = Date.now();

            console.log('[DemoFlip] phone joined room:', roomId);

            notifyDesktop(roomId, 'demo_flip_phone_connected', {
                room: getPublicRoom(room)
            });

            safeAck(ack, {
                success: true,
                room: getPublicRoom(room)
            });
        });

        /**
         * 手機端回報翻轉狀態
         * allowed states:
         * - ready
         * - face_down
         * - face_up
         * - cover_back
         */
        socket.on('demo_flip_phone_state', (payload, ack) => {
            const roomId = String(payload?.roomId || '').trim();
            const state = String(payload?.state || '').trim();

            const allowedStates = new Set([
                'ready',
                'face_down',
                'face_up',
                'cover_back'
            ]);

            if (!allowedStates.has(state)) {
                return safeAck(ack, {
                    success: false,
                    error: '未知的手機狀態'
                });
            }

            const room = demoRooms.get(roomId);

            if (!room) {
                return safeAck(ack, {
                    success: false,
                    error: '找不到此體驗房間'
                });
            }

            room.phoneSocketId = socket.id;
            room.phoneState = state;
            room.updatedAt = Date.now();

            notifyDesktop(roomId, 'demo_flip_phone_state', {
                state,
                room: getPublicRoom(room)
            });

            safeAck(ack, {
                success: true,
                state,
                room: getPublicRoom(room)
            });
        });

        /**
         * 電腦端重置 demo 手機狀態
         */
        socket.on('demo_flip_reset_room', (payload, ack) => {
            const roomId = String(payload?.roomId || '').trim();
            const room = demoRooms.get(roomId);

            if (!room) {
                return safeAck(ack, {
                    success: false,
                    error: '找不到此體驗房間'
                });
            }

            room.phoneState = room.phoneSocketId ? 'connected' : 'waiting';
            room.updatedAt = Date.now();

            io.to(room.socketRoom).emit('demo_flip_room_reset', {
                roomId,
                room: getPublicRoom(room)
            });

            safeAck(ack, {
                success: true,
                room: getPublicRoom(room)
            });
        });

        socket.on('disconnect', () => {
            for (const [roomId, room] of demoRooms.entries()) {
                if (room.desktopSocketId === socket.id) {
                    demoRooms.delete(roomId);
                    console.log('[DemoFlip] desktop disconnected, removed room:', roomId);
                    continue;
                }

                if (room.phoneSocketId === socket.id) {
                    room.phoneSocketId = null;
                    room.phoneState = 'waiting';
                    room.updatedAt = Date.now();

                    notifyDesktop(roomId, 'demo_flip_phone_disconnected', {
                        room: getPublicRoom(room)
                    });

                    console.log('[DemoFlip] phone disconnected:', roomId);
                }
            }
        });
    });

    console.log('✅ Demo Flip Socket 已啟動：demo_flip_*');
};