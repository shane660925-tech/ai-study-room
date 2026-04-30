const studentRooms = {};

module.exports = (io) => {
  io.on('connection', (socket) => {
    const { meetId, name, role } = socket.handshake.query;

    if (meetId) {
      socket.join(meetId);
      if (role === 'student') {
        studentRooms[socket.id] = meetId;
        socket.to(meetId).emit('student_joined', { socketId: socket.id, name });
      }
    }

    // [新增] 接收學生端主動轉發的狀態 (解決黃燈老師看不到的問題)
    socket.on('relay_to_teacher', (data) => {
      const targetMeetId = studentRooms[socket.id];
      if (targetMeetId) {
        io.to(targetMeetId).emit('update_status', {
          status: data.status,
          name: data.name,
          socketId: socket.id 
        });
      }
    });

    // 處理手機翻轉的狀態更新 (綠燈)
    socket.on('student_status_changed', (data) => {
      const targetMeetId = studentRooms[data.sync];
      if (targetMeetId) {
        io.to(targetMeetId).emit('update_status', {
          status: data.status,
          name: data.name,
          socketId: data.sync 
        });
      }
    });

    socket.on('disconnect', () => {
      if (studentRooms[socket.id]) {
        delete studentRooms[socket.id];
      }
    });
  });
};