import React, { useState } from 'react';
import type { ChatMessage, OnlineUser } from '../types';
import './SidePanel.css';

interface SidePanelProps {
    username: string;
    chatMessages: ChatMessage[];
    online: OnlineUser[];
    connected: boolean;
    /** вызов отправлен и ждём ответа */
    pendingTarget: string | null;
    onSendChat: (text: string) => void;
    onChallenge: (target: string) => void;
    onStartBot: () => void;
}

type Tab = 'online' | 'friends' | 'rating';

const SidePanel: React.FC<SidePanelProps> = ({
    username,
    chatMessages,
    online,
    connected,
    pendingTarget,
    onSendChat,
    onChallenge,
    onStartBot
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

    // Себя в списке не показываем
    const others = online.filter(u => u.username !== username);

    return (
        <div className="side-panel">
            {/* Чат только на вкладке Онлайн: на остальных он занимал бы
                правую колонку и мешал списку. Вкладки лежат в левой
                колонке, поэтому чат тянется во всю высоту панели */}
            <div className={`side-body ${activeTab === 'online' ? '' : 'no-chat'}`}>
                <div className="side-list">
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

                    <div className="side-scroll">
                        {activeTab === 'online' && (
                            <div className="online-section">
                                <div className="online-header">
                                    Онлайн: {online.length}
                                    {!connected && <span className="offline-note">нет связи</span>}
                                </div>

                                <button
                                    className="btn btn-online-bot"
                                    onClick={onStartBot}
                                    disabled={!connected}
                                >
                                    Игра против бота
                                </button>

                                <ul className="online-list">
                                    {others.length === 0 && (
                                        <li className="online-empty">
                                            Других игроков нет — откройте вторую вкладку
                                        </li>
                                    )}
                                    {others.map(u => {
                                        const pending = pendingTarget === u.username;
                                        return (
                                            <li key={u.username} className="online-item">
                                                <span className="online-dot" />
                                                <div className="online-info">
                                                    <div className="online-name">{u.username}</div>
                                                    <div className="online-rating">
                                                        рейтинг {u.rating}
                                                    </div>
                                                </div>
                                                <button
                                                    className="btn-online-challenge"
                                                    disabled={u.inMatch || !!pending}
                                                    onClick={() => onChallenge(u.username)}
                                                    title={
                                                        u.inMatch
                                                            ? 'Игрок уже в матче'
                                                            : pending
                                                                ? 'Ждём ответа'
                                                                : 'Вызвать на игру'
                                                    }
                                                >
                                                    {u.inMatch ? 'играет' : pending ? 'ждём' : 'вызвать'}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
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
