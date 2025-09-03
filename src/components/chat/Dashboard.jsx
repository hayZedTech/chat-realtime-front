import { useEffect, useState, useRef } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import axios from "axios";
import io from 'socket.io-client';
import {
  MdOutlineModeNight,
  MdOutlineWbSunny,
  MdOutlineDelete,
  MdClose,
  MdMenu,
  MdArrowBackIos,
  MdSend,
  MdMoreVert,
  MdOutlineReply,
  MdOutlineEdit,
  MdFavorite,
  MdAttachFile,
  MdImage,
  MdMic,
  MdDownload,
  MdCheckCircle,
  MdPause,
  MdPlayArrow,
  MdCheck,
  MdStop,
  MdCamera
} from 'react-icons/md';

const URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Enhanced sound utility
const playSound = (type) => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const frequencies = { send: 800, receive: 600, typing: 400, notification: 1000 };
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(frequencies[type] || 600, audioContext.currentTime);
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (err) {
    console.log('Sound not available');
  }
};

// Date formatter
const formatMessageDate = (date) => {
  const now = new Date();
  const messageDate = new Date(date);
  const diffInHours = (now - messageDate) / (1000 * 60 * 60);
  const diffInDays = Math.floor(diffInHours / 24);
  
  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  
  return messageDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: messageDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
};

const Dashboard = () => {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [msgInput, setMsgInput] = useState("");
  const [selectedChat, setSelectedChat] = useState({ type: "general", data: null });
  const [loading, setLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  
  // Enhanced features
  const [activeMenu, setActiveMenu] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [editText, setEditText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [playingVoice, setPlayingVoice] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const navigate = useNavigate();
  const messagesEndRef = useRef();
  const fileInputRef = useRef();
  const imageInputRef = useRef();
  const typingTimeoutRef = useRef();
  const recordingIntervalRef = useRef();

  if (!user) return <Navigate to="/login" replace />;

  // Socket setup with proper message filtering
  useEffect(() => {
    const socketInstance = io(URL, { transports: ['websocket', 'polling'] });

    socketInstance.on('connect', () => {
      setConnectionStatus('connected');
      socketInstance.emit('user-online', user.id);
    });

    socketInstance.on('disconnect', () => setConnectionStatus('disconnected'));
    socketInstance.on('connect_error', () => setConnectionStatus('error'));

    socketInstance.on('new-message', (message) => {
      // Only add message if it belongs to current chat
      const isForCurrentChat = 
        (selectedChat.type === 'general' && !message.recipient_id) ||
        (selectedChat.type === 'private' && selectedChat.data && 
         ((message.sender_id === user.id && message.recipient_id === selectedChat.data.id) ||
          (message.sender_id === selectedChat.data.id && message.recipient_id === user.id)));

      if (isForCurrentChat) {
        setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
      }
      
      // Sound and notification
      if (message.sender_id !== user.id) {
        playSound('receive');
        
        // Update unread counts
        if (!isForCurrentChat) {
          const chatKey = message.recipient_id ? `private-${message.sender_id}` : 'general';
          setUnreadCounts(prev => ({
            ...prev,
            [chatKey]: (prev[chatKey] || 0) + 1
          }));
        }
        
        if (document.hidden) {
          new Notification(`New message from ${message.sender_name}`, {
            body: message.message_type === 'text' ? message.message : `Sent a ${message.message_type}`,
            icon: '/favicon.ico'
          });
        }
      }
    });

    socketInstance.on('message-delivered', ({ tempId, messageId }) => {
      setMessages(prev => prev.map(msg => 
        msg.id === tempId ? { ...msg, id: messageId, status: 'delivered' } : msg
      ));
    });

    socketInstance.on('message-deleted', ({ messageId }) => {
      setMessages(prev => prev.filter(msg => msg.id !== messageId));
    });

    socketInstance.on('message-edited', ({ messageId, newText }) => {
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, message: newText, edited_at: new Date().toISOString() } : msg
      ));
    });

    socketInstance.on('user-typing', ({ userId, username, isTyping, chatType, recipientId }) => {
      if (userId !== user.id) {
        // Only show typing for current chat
        const isForCurrentChat = 
          (selectedChat.type === 'general' && chatType === 'general') ||
          (selectedChat.type === 'private' && selectedChat.data && 
           (recipientId === user.id || userId === selectedChat.data.id));

        if (isForCurrentChat) {
          setTypingUsers(prev => {
            const newSet = new Set(prev);
            isTyping ? newSet.add(username) : newSet.delete(username);
            return newSet;
          });
        }
      }
    });

    socketInstance.on('user-status-change', ({ userId, status }) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        status === 'online' ? newSet.add(userId) : newSet.delete(userId);
        return newSet;
      });
    });

    setSocket(socketInstance);
    return () => socketInstance.disconnect();
  }, [user.id, selectedChat]);

  // Fetch data
  useEffect(() => { fetchUsers(); }, []);
  useEffect(() => { 
    fetchMessages();
    // Clear unread for current chat
    const chatKey = selectedChat.type === 'general' ? 'general' : `private-${selectedChat.data?.id}`;
    setUnreadCounts(prev => ({ ...prev, [chatKey]: 0 }));
  }, [selectedChat]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const fetchUsers = async () => {
    try {
      const res = await axios.get(`${URL}/api/messages/users`);
      setUsers(res.data.filter(u => u.id !== user.id));
    } catch (err) {
      console.error('Fetch users error:', err);
    }
  };

  const fetchMessages = async () => {
    try {
      setLoading(true);
      let endpoint = `${URL}/api/messages/general`;
      
      if (selectedChat.type === "private" && selectedChat.data) {
        endpoint = `${URL}/api/messages/private/${selectedChat.data.id}?currentUserId=${user.id}`;
      }
      
      const res = await axios.get(endpoint);
      setMessages(res.data || []);
    } catch (err) {
      console.error('Fetch messages error:', err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!msgInput.trim()) return;

    const tempId = `temp-${Date.now()}`;
    const tempMessage = {
      id: tempId,
      message: msgInput,
      sender_id: user.id,
      sender_name: user.username,
      created_at: new Date().toISOString(),
      message_type: 'text',
      status: 'sending',
      reply_to: replyingTo?.id || null,
      recipient_id: selectedChat.type === 'private' ? selectedChat.data?.id : null
    };

    setMessages(prev => [...prev, tempMessage]);
    playSound('send');

    if (socket && socket.connected) {
      socket.emit('send-message', {
        tempId,
        sender_id: user.id,
        message: msgInput,
        chatType: selectedChat.type,
        recipient_id: selectedChat.data?.id,
        message_type: 'text',
        reply_to: replyingTo?.id
      });
    }

    setMsgInput("");
    setReplyingTo(null);
    handleStopTyping();
  };

  const handleTyping = (value) => {
    setMsgInput(value);
    
    if (!isTyping && value.trim()) {
      setIsTyping(true);
      socket?.emit('typing', { 
        userId: user.id, 
        username: user.username, 
        isTyping: true,
        chatType: selectedChat.type,
        recipientId: selectedChat.data?.id
      });
    }
    
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      handleStopTyping();
    }, 3000);
  };

  const handleStopTyping = () => {
    if (isTyping) {
      setIsTyping(false);
      socket?.emit('typing', { 
        userId: user.id, 
        username: user.username, 
        isTyping: false,
        chatType: selectedChat.type,
        recipientId: selectedChat.data?.id
      });
    }
  };

  const handleMenuAction = (action, message) => {
    setActiveMenu(null);
    
    switch(action) {
      case 'reply':
        setReplyingTo(message);
        break;
      case 'edit':
        setEditingMessage(message.id);
        setEditText(message.message);
        break;
      case 'delete':
        setShowDeleteModal(message);
        break;
      case 'react':
        handleReaction(message.id, '❤️');
        break;
    }
  };

  const handleEdit = async (messageId) => {
    if (!editText.trim()) return;
    
    setActionLoading(`edit-${messageId}`);
    try {
      socket?.emit('edit-message', { messageId, newText: editText });
      setEditingMessage(null);
      setEditText('');
    } finally {
      setTimeout(() => setActionLoading(null), 500);
    }
  };

  const handleDelete = async (messageId) => {
    setActionLoading(`delete-${messageId}`);
    try {
      socket?.emit('delete-message', { messageId });
      setShowDeleteModal(null);
    } finally {
      setTimeout(() => setActionLoading(null), 1000);
    }
  };

  const handleReaction = (messageId, emoji) => {
    socket?.emit('add-reaction', { messageId, emoji, userId: user.id });
  };

  // Enhanced file upload with preview
  const handleFileUpload = async (file, type) => {
    if (!file) return;

    // Show preview for images
    if (type === 'image') {
      const reader = new FileReader();
      reader.onload = (e) => {
        setFilePreview({
          type: 'image',
          file,
          preview: e.target.result,
          name: file.name
        });
      };
      reader.readAsDataURL(file);
      return;
    }

    // For non-images, show file info
    setFilePreview({
      type: 'file',
      file,
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB'
    });
  };

  const sendFileMessage = async () => {
    if (!filePreview) return;

    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', filePreview.file);
      formData.append('sender_id', user.id);
      formData.append('chatType', selectedChat.type);
      formData.append('message_type', filePreview.type);
      
      if (selectedChat.type === 'private') {
        formData.append('recipient_id', selectedChat.data.id);
      }

      const response = await axios.post(`${URL}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        playSound('send');
        setFilePreview(null);
      }
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploadLoading(false);
    }
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      setMediaRecorder(recorder);
      setIsRecording(true);
      setRecordingTime(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        
        // Send voice message
        const formData = new FormData();
        formData.append('file', blob, 'voice-note.webm');
        formData.append('sender_id', user.id);
        formData.append('chatType', selectedChat.type);
        formData.append('message_type', 'voice');
        formData.append('voice_duration', recordingTime);
        
        if (selectedChat.type === 'private') {
          formData.append('recipient_id', selectedChat.data.id);
        }

        try {
          const response = await axios.post(`${URL}/api/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
          
          if (response.data.success) {
            playSound('send');
          }
        } catch (err) {
          console.error('Voice upload failed:', err);
        }
      };

      recorder.start();
      playSound('notification');
    } catch (err) {
      alert('Could not access microphone');
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      clearInterval(recordingIntervalRef.current);
      setIsRecording(false);
      setMediaRecorder(null);
      setRecordingTime(0);
    }
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      clearInterval(recordingIntervalRef.current);
      setIsRecording(false);
      setMediaRecorder(null);
      setRecordingTime(0);
    }
  };

  const toggleVoicePlayback = (messageId) => {
    if (playingVoice === messageId) {
      setPlayingVoice(null);
    } else {
      setPlayingVoice(messageId);
      setTimeout(() => setPlayingVoice(null), 3000);
    }
  };

  const toggleTheme = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  };

  const toggleSidebar = () => {
    document.body.classList.toggle('show-sidebar');
  };

  const handleLogout = () => {
    if (socket) socket.disconnect();
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    navigate("/login");
  };

  const getInitials = (name) => {
    return name ? name.split(" ").map(n => n[0]).join("").toUpperCase() : "??";
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = formatMessageDate(message.created_at);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {});

  return (
    <div className="app">
      {/* Connection Status */}
      {connectionStatus !== 'connected' && (
        <div className={`connection-status ${connectionStatus}`}>
          {connectionStatus === 'connecting' && '🔄 Connecting...'}
          {connectionStatus === 'disconnected' && '⚠️ Disconnected'}
          {connectionStatus === 'error' && '❌ Connection Error'}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner"></div>
          <div className="loading-text">Loading messages...</div>
        </div>
      )}

      {/* File Preview Modal */}
      {filePreview && (
        <div className="modal-overlay" onClick={() => setFilePreview(null)}>
          <div className="file-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="preview-header">
              <h3>Send {filePreview.type === 'image' ? 'Image' : 'File'}</h3>
              <button onClick={() => setFilePreview(null)} className="close-btn">
                <MdClose />
              </button>
            </div>
            
            <div className="preview-content">
              {filePreview.type === 'image' ? (
                <img 
                  src={filePreview.preview} 
                  alt={filePreview.name}
                  className="preview-image"
                />
              ) : (
                <div className="preview-file">
                  <MdAttachFile className="file-icon-large" />
                  <div className="file-details">
                    <div className="file-name">{filePreview.name}</div>
                    <div className="file-size">{filePreview.size}</div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="preview-actions">
              <button 
                onClick={() => setFilePreview(null)} 
                className="btn-cancel"
                disabled={uploadLoading}
              >
                Cancel
              </button>
              <button 
                onClick={sendFileMessage} 
                className="btn-send"
                disabled={uploadLoading}
              >
                {uploadLoading ? (
                  <>
                    <div className="loading-spinner-small"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <MdSend /> Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Delete Message</h3>
            <p>Are you sure you want to delete this message? This action cannot be undone.</p>
            <div className="modal-actions">
              <button 
                className="btn-cancel" 
                onClick={() => setShowDeleteModal(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button 
                className="btn-delete" 
                onClick={() => handleDelete(showDeleteModal.id)}
                disabled={actionLoading}
              >
                {actionLoading === `delete-${showDeleteModal.id}` ? (
                  <>
                    <div className="loading-spinner-small"></div>
                    Deleting...
                  </>
                ) : (
                  <>
                    <MdOutlineDelete /> Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="topbar">
        <div className="brand">
          <button className="menu-btn" onClick={toggleSidebar}>
            <MdMenu />
          </button>
          <div className="logo">💬 ChatApp</div>
          <span className="username">@{user.username}</span>
        </div>
        <div className="actions">
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
            <MdOutlineModeNight className="dark-icon" />
            <MdOutlineWbSunny className="light-icon" />
          </button>
          <button className="icon-btn logout-btn" onClick={handleLogout} title="Logout">
            Logout
          </button>
        </div>
      </div>

      <div className="main">
        {/* Enhanced Sidebar with Proper Badge Counts */}
        <aside className="sidebar">
          <div className="chats">
            {/* General Chat */}
            <div 
              className={`chat-item ${selectedChat.type === 'general' ? 'active' : ''}`}
              onClick={() => {
                setSelectedChat({ type: "general", data: null });
                if (window.innerWidth <= 768) toggleSidebar();
              }}
            >
              <div className="avatar gradient-avatar">
                🌍
              </div>
              <div className="chat-info">
                <div className="name">
                  General Chat
                  <span className="chat-badge general">Public</span>
                </div>
                <div className="preview">Everyone can see these messages</div>
              </div>
              {unreadCounts.general > 0 && (
                <div className="unread-badge">{unreadCounts.general}</div>
              )}
            </div>

            {/* Private Chats */}
            {users.length > 0 ? (
              users.map(u => {
                const unreadKey = `private-${u.id}`;
                const unreadCount = unreadCounts[unreadKey] || 0;
                
                return (
                  <div 
                    key={u.id} 
                    className={`chat-item ${selectedChat.type === 'private' && selectedChat.data?.id === u.id ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedChat({ type: "private", data: u });
                      if (window.innerWidth <= 768) toggleSidebar();
                    }}
                  >
                    <div className="avatar gradient-avatar">
                      {getInitials(u.username)}
                    </div>
                    <div className="chat-info">
                      <div className="name">
                        {u.username}
                        {onlineUsers.has(u.id) && <span className="online-dot"></span>}
                        <span className="chat-badge private">Private</span>
                      </div>
                      <div className="preview">
                        {onlineUsers.has(u.id) ? 'Online now' : 'Tap to start chatting'}
                      </div>
                    </div>
                    {unreadCount > 0 && (
                      <div className="unread-badge">{unreadCount}</div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="chat-item empty-state">
                <div className="avatar">👥</div>
                <div className="chat-info">
                  <div className="name">No contacts yet</div>
                  <div className="preview">Invite friends to join!</div>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Enhanced Chat Area */}
        <section className="chat">
          {/* Chat Header with Enhanced Typing Indicator */}
          <div className="chat-header">
            <button className="go-back-btn" onClick={toggleSidebar}>
              <MdArrowBackIos />
            </button>
            <div className="avatar gradient-avatar">
              {selectedChat.type === 'general' ? '🌍' : getInitials(selectedChat.data?.username)}
            </div>
            <div className="chat-title">
              <div className="name">
                {selectedChat.type === 'general' 
                  ? 'General Chat' 
                  : selectedChat.data?.username || 'Private Chat'}
                {selectedChat.type === 'private' && selectedChat.data && onlineUsers.has(selectedChat.data.id) && (
                  <span className="online-dot"></span>
                )}
              </div>
              {typingUsers.size > 0 && (
                <div className="typing-indicator">
                  <span>{Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing</span>
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Enhanced Messages with Adaptive Bubbles */}
          <div className="messages">
            {Object.keys(groupedMessages).length === 0 ? (
              <div className="empty-chat-state">
                <div className="empty-icon">💬</div>
                <h3>Start the conversation</h3>
                <p>Send a message to begin chatting{selectedChat.type === 'private' ? ` with ${selectedChat.data?.username}` : ' in the general chat'}!</p>
              </div>
            ) : (
              Object.entries(groupedMessages).map(([date, dateMessages]) => (
                <div key={date}>
                  <div className="date-separator">
                    <span>{date}</span>
                  </div>
                  
                  {dateMessages.map(m => {
                    const isOwn = m.sender_id === user.id;
                    const replyMessage = m.reply_to ? messages.find(msg => msg.id === m.reply_to) : null;
                    const isShortMessage = m.message && m.message.length < 50;
                    
                    return (
                      <div key={m.id} className={`message-bubble ${isOwn ? 'own' : ''} ${isShortMessage ? 'short' : 'long'}`}>
                        <div className="message-content">
                          {/* Reply Preview with Glassmorphism */}
                          {replyMessage && (
                            <div className="reply-preview-glass">
                              <div className="reply-author">
                                {replyMessage.sender_id === user.id ? 'You' : replyMessage.sender_name}
                              </div>
                              <div className="reply-text">
                                {replyMessage.message_type === 'text' 
                                  ? (replyMessage.message.length > 30 ? replyMessage.message.slice(0, 30) + '...' : replyMessage.message)
                                  : `📎 ${replyMessage.message_type} message`
                                }
                              </div>
                            </div>
                          )}

                          {editingMessage === m.id ? (
                            /* Edit Mode */
                            <div className="edit-container">
                              <textarea
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleEdit(m.id)}
                                className="edit-input"
                                autoFocus
                                rows="2"
                              />
                              <div className="edit-actions">
                                <button 
                                  onClick={() => handleEdit(m.id)} 
                                  className="btn-send"
                                  disabled={!editText.trim() || actionLoading === `edit-${m.id}`}
                                >
                                  {actionLoading === `edit-${m.id}` ? (
                                    <>
                                      <div className="loading-spinner-small"></div>
                                      Saving...
                                    </>
                                  ) : (
                                    <>
                                      <MdCheck /> Save
                                    </>
                                  )}
                                </button>
                                <button 
                                  onClick={() => {
                                    setEditingMessage(null);
                                    setEditText('');
                                  }} 
                                  className="btn-cancel"
                                  disabled={actionLoading === `edit-${m.id}`}
                                >
                                  <MdClose /> Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Normal Message Display */
                            <>
                              <div className="message-header">
                                <span className="sender-name">
                                  {isOwn ? 'You' : m.sender_name}
                                </span>
                                
                                {/* Message Content by Type */}
                                {m.message_type === 'voice' ? (
                                  <div className="voice-player">
                                    <button 
                                      className="play-btn"
                                      onClick={() => toggleVoicePlayback(m.id)}
                                      disabled={!m.media_url}
                                    >
                                      {playingVoice === m.id ? <MdPause /> : <MdPlayArrow />}
                                    </button>
                                    <div className="voice-waveform">
                                      <div className={`wave-animation ${playingVoice === m.id ? 'playing' : ''}`}>
                                        <div className="wave-bar"></div>
                                        <div className="wave-bar"></div>
                                        <div className="wave-bar"></div>
                                        <div className="wave-bar"></div>
                                        <div className="wave-bar"></div>
                                      </div>
                                    </div>
                                    <span className="voice-time">{m.voice_duration || 0}s</span>
                                  </div>
                                ) : m.message_type === 'image' ? (
                                  <div className="media-content">
                                    <div className="image-container">
                                      <img 
                                        src={`${URL}${m.media_url}`}
                                        alt="Shared image"
                                        className="message-image"
                                        onClick={() => window.open(`${URL}${m.media_url}`, '_blank')}
                                        onLoad={(e) => {
                                          // Auto-resize based on aspect ratio
                                          const img = e.target;
                                          const aspectRatio = img.naturalWidth / img.naturalHeight;
                                          if (aspectRatio > 1.5) {
                                            img.style.width = '280px';
                                            img.style.height = 'auto';
                                          } else {
                                            img.style.maxHeight = '200px';
                                            img.style.width = 'auto';
                                          }
                                        }}
                                      />
                                      <div className="image-overlay">
                                        <MdCamera className="image-icon" />
                                      </div>
                                    </div>
                                    {m.message && m.message !== 'Image' && (
                                      <div className="image-caption">{m.message}</div>
                                    )}
                                  </div>
                                ) : m.message_type === 'file' ? (
                                  <div className="file-content">
                                    <MdAttachFile className="file-icon" />
                                    <div className="file-info">
                                      <span className="file-name">{m.message}</span>
                                      <span className="file-size">Click to download</span>
                                    </div>
                                    <a 
                                      href={`${URL}${m.media_url}`}
                                      download
                                      className="download-btn"
                                      title="Download file"
                                    >
                                      <MdDownload />
                                    </a>
                                  </div>
                                ) : (
                                  <div className="message-text">{m.message}</div>
                                )}
                              </div>

                              <div className="message-footer">
                                <span className="message-time">
                                  {new Date(m.created_at).toLocaleTimeString('en-US', {
                                    hour: 'numeric',
                                    minute: '2-digit'
                                  })}
                                  {m.edited_at && <span className="edited-indicator"> (edited)</span>}
                                </span>
                                
                                {/* Message Status */}
                                {isOwn && (
                                  <div className="message-status">
                                    {m.status === 'sending' && <span className="status-sending">⏳</span>}
                                    {m.status === 'delivered' && <MdCheckCircle className="status-delivered" />}
                                    {!m.status && <MdCheckCircle className="status-delivered" />}
                                  </div>
                                )}

                                {/* Enhanced Message Menu */}
                                <div className="message-menu-container">
                                  <button 
                                    className="message-menu-btn" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMenu(activeMenu === m.id ? null : m.id);
                                    }}
                                  >
                                    <MdMoreVert />
                                  </button>
                                  
                                  {activeMenu === m.id && (
                                    <div className="message-menu" onClick={(e) => e.stopPropagation()}>
                                      <button onClick={() => handleMenuAction('reply', m)}>
                                        <MdOutlineReply /> Reply
                                      </button>
                                      <button onClick={() => handleMenuAction('react', m)}>
                                        <MdFavorite /> React
                                      </button>
                                      {isOwn && m.message_type === 'text' && (
                                        <button onClick={() => handleMenuAction('edit', m)}>
                                          <MdOutlineEdit /> Edit
                                        </button>
                                      )}
                                      {(isOwn || selectedChat.type === 'general') && (
                                        <button 
                                          onClick={() => handleMenuAction('delete', m)}
                                          className="delete-option"
                                        >
                                          <MdOutlineDelete /> Delete
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Reactions */}
                              {m.reactions && Array.isArray(m.reactions) && m.reactions.length > 0 && (
                                <div className="message-reactions">
                                  {m.reactions.map((reaction, idx) => (
                                    <span key={idx} className="reaction" onClick={() => handleReaction(m.id, reaction.emoji)}>
                                      {reaction.emoji} {reaction.count}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply Bar with Glassmorphism */}
          {replyingTo && (
            <div className="reply-bar">
              <div className="reply-info">
                <MdOutlineReply className="reply-icon" />
                <div className="reply-details">
                  <span className="reply-to">
                    Replying to {replyingTo.sender_id === user.id ? 'yourself' : replyingTo.sender_name}
                  </span>
                  <span className="reply-preview-text">
                    {replyingTo.message_type === 'text' 
                      ? (replyingTo.message.length > 50 ? replyingTo.message.slice(0, 50) + '...' : replyingTo.message)
                      : `📎 ${replyingTo.message_type} message`
                    }
                  </span>
                </div>
              </div>
              <button 
                className="reply-cancel-btn"
                onClick={() => setReplyingTo(null)}
              >
                <MdClose />
              </button>
            </div>
          )}

          {/* Enhanced Composer with All Features */}
          <form className="composer" onSubmit={handleSendMessage}>
            <div className="composer-actions">
              {/* File Upload */}
              <button 
                type="button" 
                className="composer-btn" 
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
                disabled={isRecording || uploadLoading}
              >
                <MdAttachFile />
              </button>
              
              {/* Image Upload */}
              <button 
                type="button" 
                className="composer-btn" 
                onClick={() => imageInputRef.current?.click()}
                title="Send image"
                disabled={isRecording || uploadLoading}
              >
                <MdImage />
              </button>
              
              {/* Voice Recording */}
              {!isRecording ? (
                <button 
                  type="button" 
                  className="composer-btn voice-btn" 
                  onClick={startVoiceRecording}
                  title="Record voice message"
                  disabled={uploadLoading}
                >
                  <MdMic />
                </button>
              ) : (
                <div className="recording-controls">
                  <div className="recording-indicator">
                    <div className="recording-dot"></div>
                    <span className="recording-time">
                      {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <button 
                    type="button" 
                    className="stop-recording-btn" 
                    onClick={stopVoiceRecording}
                    title="Send voice message"
                  >
                    <MdSend />
                  </button>
                  <button 
                    type="button" 
                    className="cancel-recording-btn" 
                    onClick={cancelVoiceRecording}
                    title="Cancel recording"
                  >
                    <MdClose />
                  </button>
                </div>
              )}
            </div>

            <div className="composer-main">
              <textarea
                className="message-input"
                value={msgInput}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleStopTyping}
                placeholder={
                  replyingTo 
                    ? `Reply to ${replyingTo.sender_name}...`
                    : selectedChat.type === 'general' 
                      ? "Message everyone..." 
                      : `Message ${selectedChat.data?.username}...`
                }
                rows={1}
                disabled={isRecording || uploadLoading}
              />
            </div>
            
            <button 
              type="submit" 
              className="send-btn" 
              disabled={!msgInput.trim() || isRecording || uploadLoading}
              title="Send message"
            >
              {uploadLoading ? (
                <div className="loading-spinner-small"></div>
              ) : (
                <MdSend />
              )}
            </button>

            {/* Hidden File Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  handleFileUpload(file, 'file');
                  e.target.value = '';
                }
              }}
              accept="*/*"
            />
            <input
              ref={imageInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  handleFileUpload(file, 'image');
                  e.target.value = '';
                }
              }}
              accept="image/*"
            />
          </form>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;