// 建立一個記憶對照表，記錄「學生擴充套件 ID」對應的「會議室代碼」
const studentRooms = {};

module.exports = (io) => {
  io.on('connection', (socket) => {
    const { meetId, name, role } = socket.handshake.query;

    // 1. 使用者加入專屬會議室
    if (meetId) {
      socket.join(meetId);
      
      // 如果是學生擴充套件連線，記錄他的房間，並通知老師
      if (role === 'student') {
        studentRooms[socket.id] = meetId;
        socket.to(meetId).emit('student_joined', { socketId: socket.id, name });
      }
    }

    // 2. 處理手機翻轉的狀態更新
    socket.on('student_status_changed', (data) => {
      // data.sync 是手機傳來的「學生擴充套件 Socket ID」
      // 透過對照表，找出這個學生在哪個會議室
      const targetMeetId = studentRooms[data.sync];

      if (targetMeetId) {
        // 精準廣播給該會議室的老師與學生！
        io.to(targetMeetId).emit('update_status', {
          status: data.status,
          name: data.name,
          socketId: data.sync // 確保老師端能用這個 ID 找到對應的 UI
        });
      }
    });

    // 3. 斷線時清理記憶體
    socket.on('disconnect', () => {
      if (studentRooms[socket.id]) {
        delete studentRooms[socket.id];
      }
    });
  });
};