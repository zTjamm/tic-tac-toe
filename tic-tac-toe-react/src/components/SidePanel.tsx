import React, { useState } from 'react';
import './SidePanel.css';

interface SidePanelProps {
    username: string;
    onlineUsers: string[];
    chatMessages: Array<{ sender: string; text: string }>;
    onStartBot: () => void;
    onSendChat: (text: string) => void;
    onSendChallenge: (targetUsername: string) => void;
}

const SidePanel: React.FC<SidePanelProps> = ({
    username,
    onlineUsers,
    chatMessages,
    onStartBot,
    onSendChat,
}) => {
    const [activeTab, setActiveTab] = useState<'online' | 'friends' | 'leaderboard'>('online');
    const [chatInput, setChatInput] = useState('');

    const handleSendChat = () => {
        if (chatInput.trim()) {
            onSendChat(chatInput.trim());
            setChatInput('');
        }
    };

    return (
        <div className="side-panel">
            <div className="side-tabs">
                <button
                    className={`side-tab ${activeTab === 'online' ? 'active' : ''}`}
                    onClick={() => setActiveTab('online')}
                >
                    Онлайн
                </button>
                <button
                    className={`side-tab ${activeTab === 'friends' ? 'active' : ''}`}
                    onClick={() => setActiveTab('friends')}
                >
                    Друзья
                </button>
                <button
                    className={`side-tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('leaderboard')}
                >
                    Рейтинг
                </button>
            </div>

            <div className="side-content">
                {activeTab === 'online' && (
                    <div className="online-section">
                        <div className="online-header">
                            <span>Онлайн: {onlineUsers.length}</span>
                        </div>
                        <div className="online-list">
                            {onlineUsers.map(user => (
                                <div key={user} className="online-item">
                                    <span className="online-dot"></span>
                                    <div className="online-info">
                                        <div className="online-name">{user}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="online-actions">
                            <button className="btn" onClick={onStartBot}>Игра против бота</button>
                        </div>
                    </div>
                )}

                {activeTab === 'friends' && (
                    <div className="friends-section">
                        <p>Список друзей пуст</p>
                    </div>
                )}

                {activeTab === 'leaderboard' && (
                    <div className="leaderboard-section">
                        <p>Таблица лидеров</p>
                    </div>
                )}
            </div>

            <div className="chat-section">
                <div className="chat-header">
                    <span>Общий чат</span>
                </div>
                <div className="chat-messages">
                    {chatMessages.map((msg, i) => (
                        <div key={i} className={`chat-message ${msg.sender === username ? 'own' : 'other'}`}>
                            <div className="sender">{msg.sender}</div>
                            <div className="text">{msg.text}</div>
                        </div>
                    ))}
                </div>
                <div className="chat-input">
                    <input
                        type="text"
                        placeholder="Сообщение всем..."
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                        maxLength={200}
                    />
                    <button className="btn-small" onClick={handleSendChat}>➤</button>
                </div>
            </div>
        </div>
    );
};

export default SidePanel;
