// sockets/roomHandler.js

module.exports = (io) => {
  io.on('connection', (socket) => {
    // 1. 取得前端傳來的 meetId, name, role
    const { meetId, name, role } = socket.handshake.query;

    if (meetId) {
      // 2. 讓使用者加入專屬該會議的房間
      socket.join(meetId);
      console.log(`${name}(${role}) 加入了會議室: ${meetId}`);

      // 3. 如果是學生連線，告知該房間的老師
      if (role === 'student') {
        // 只傳給同一個 meetId 房間裡的其他人（老師）
        socket.to(meetId).emit('student_joined', { socketId: socket.id, name });
      }
    }

    // 4. 處理學生翻轉手機後的狀態更新
    socket.on('student_status_changed', (data) => {
      // data 包含：status (red/yellow/green), name 等
      // 使用 io.to(meetId).emit，確保只有「同一個會議室」的老師會收到
      io.to(meetId).emit('update_status', {
        ...data,
        socketId: socket.id
      });
    });

    socket.on('disconnect', () => {
      console.log(`${name} 已斷線`);
    });
  });
};