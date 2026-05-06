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

    // 👇 負責接收手機傳來的違規，轉發給老師端
    socket.on('violation_record', (data) => {
      const targetMeetId = studentRooms[data.sync];
      if (targetMeetId) {
        io.to(targetMeetId).emit('violation_alert', {
          socketId: data.sync,
          message: data.message
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