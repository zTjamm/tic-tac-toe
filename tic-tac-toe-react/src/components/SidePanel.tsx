import React, { useState } from 'react';
import type { ChatMessage } from '../types';
import './SidePanel.css';

interface SidePanelProps {
    username: string;
    chatMessages: ChatMessage[];
    connected: boolean;
    onSendChat: (text: string) => void;
}

type Tab = 'online' | 'friends' | 'rating';

const SidePanel: React.FC<SidePanelProps> = ({
    username,
    chatMessages,
    connected,
    onSendChat
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('online');
    const [chatInput, setChatInput] = useState('');

    const handleSendChat = () => {
        const text = chatInput.trim();
        if (text) {
            onSendChat(text);
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
                    className={`side-tab ${activeTab === 'rating' ? 'active' : ''}`}
                    onClick={() => setActiveTab('rating')}
                >
                    Рейтинг
                </button>
            </div>

            {/* Чат показывается только на вкладке Онлайн: на остальных
                он занимает правую колонку и мешал бы списку */}
            <div className={`side-body ${activeTab === 'online' ? '' : 'no-chat'}`}>
                <div className="side-list">
                    {activeTab === 'online' && (
                        <div className="online-section">
                            <div className="online-header">
                                Онлайн
                                {!connected && <span className="offline-note">нет связи</span>}
                            </div>
                            <p className="side-hint">
                                Соперников видно здесь. Вызов на игру появится после подключения
                                онлайн-режима.
                            </p>
                        </div>
                    )}

                    {activeTab === 'friends' && (
                        <div className="friends-section">
                            <div className="online-header">Друзья</div>
                            <p className="side-hint">Список друзей пока пуст.</p>
                        </div>
                    )}

                    {activeTab === 'rating' && (
                        <div className="leaderboard-section">
                            <div className="online-header">Таблица лидеров</div>
                            <p className="side-hint">Рейтинг начисляется по итогам матча.</p>
                        </div>
                    )}
                </div>

                {activeTab === 'online' && (
                    <div className="chat-section">
                        <div className="chat-header">Общий чат</div>
                        <div className="chat-messages">
                            {chatMessages.length === 0 && (
                                <p className="chat-empty">Сообщений пока нет</p>
                            )}
                            {chatMessages.map((msg, i) => (
                                <div
                                    key={i}
                                    className={`chat-message ${
                                        msg.sender === username ? 'own' : 'other'
                                    }`}
                                >
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
                                onChange={e => setChatInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                                maxLength={200}
                            />
                            <button className="btn-small" onClick={handleSendChat}>
                                ➤
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SidePanel;
