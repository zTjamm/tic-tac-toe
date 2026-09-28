import React, { useEffect, useState } from 'react';
import type { ChatMessage, OnlineUser, Friend, LeaderboardEntry } from '../types';
import './SidePanel.css';

interface SidePanelProps {
    username: string;
    chatMessages: ChatMessage[];
    online: OnlineUser[];
    friends: Friend[];
    leaderboard: LeaderboardEntry[];
    connected: boolean;
    /** вызов отправлен и ждём ответа */
    pendingTarget: string | null;
    onSendChat: (text: string) => void;
    onChallenge: (target: string) => void;
    onStartBot: () => void;
    onAddFriend: (name: string) => void;
    onRemoveFriend: (name: string) => void;
    /** стабильные загрузчики: если они меняются на каждом рендере,
        эффект ниже начнёт перезапрашивать данные бесконечно */
    loadFriends: () => void;
    loadLeaderboard: () => void;
}

type Tab = 'online' | 'friends' | 'rating';

const SidePanel: React.FC<SidePanelProps> = ({
    username,
    chatMessages,
    online,
    friends,
    leaderboard,
    connected,
    pendingTarget,
    onSendChat,
    onChallenge,
    onStartBot,
    onAddFriend,
    onRemoveFriend,
    loadFriends,
    loadLeaderboard
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('online');
    const [chatInput, setChatInput] = useState('');
    const [friendInput, setFriendInput] = useState('');

    // Данные вкладок меняются после каждого матча, поэтому тянем их при
    // открытии, а не один раз при загрузке страницы
    useEffect(() => {
        if (activeTab === 'rating') loadLeaderboard();
    }, [activeTab, loadLeaderboard]);

    useEffect(() => {
        if (activeTab === 'friends') loadFriends();
    }, [activeTab, loadFriends]);

    const switchTab = (tab: Tab) => setActiveTab(tab);

    const handleSendChat = () => {
        const text = chatInput.trim();
        if (text) {
            onSendChat(text);
            setChatInput('');
        }
    };

    const handleAddFriend = () => {
        const name = friendInput.trim();
        if (!name) return;
        onAddFriend(name);
        setFriendInput('');
    };

    // Себя в списке не показываем
    const others = online.filter(u => u.username !== username);
    const friendNames = new Set(friends.map(f => f.username));

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
                            onClick={() => switchTab('online')}
                        >
                            Онлайн
                        </button>
                        <button
                            className={`side-tab ${activeTab === 'friends' ? 'active' : ''}`}
                            onClick={() => switchTab('friends')}
                        >
                            Друзья
                        </button>
                        <button
                            className={`side-tab ${activeTab === 'rating' ? 'active' : ''}`}
                            onClick={() => switchTab('rating')}
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
                                        const isFriend = friendNames.has(u.username);
                                        return (
                                            <li key={u.username} className="online-item">
                                                <div className="online-row">
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
                                                </div>
                                                <button
                                                    className={`btn-friend-toggle ${isFriend ? 'is-friend' : ''}`}
                                                    onClick={() =>
                                                        isFriend
                                                            ? onRemoveFriend(u.username)
                                                            : onAddFriend(u.username)
                                                    }
                                                    title={
                                                        isFriend
                                                            ? 'Убрать из друзей'
                                                            : 'Добавить в друзья'
                                                    }
                                                >
                                                    {isFriend ? '✓ в друзьях' : '+ в друзья'}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {activeTab === 'friends' && (
                            <div className="friends-section">
                                <div className="online-header">
                                    Друзья: {friends.length}
                                </div>

                                {/* Добавление по нику: незнакомого игрока может
                                    не быть в онлайне, но он мог сыграть раньше */}
                                <div className="friend-add">
                                    <input
                                        type="text"
                                        placeholder="Ник для добавления"
                                        value={friendInput}
                                        onChange={e => setFriendInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddFriend()}
                                        maxLength={32}
                                    />
                                    <button className="btn-small" onClick={handleAddFriend}>
                                        +
                                    </button>
                                </div>

                                {friends.length === 0 ? (
                                    <p className="side-hint">
                                        Список пуст. Добавьте игрока по нику или кнопкой
                                        «+ в друзья» в списке онлайна.
                                    </p>
                                ) : (
                                    <ul className="online-list">
                                        {friends.map(f => {
                                            const pending = pendingTarget === f.username;
                                            return (
                                                <li key={f.username} className="online-item">
                                                    <div className="online-row">
                                                        <span
                                                            className={`online-dot ${f.online ? '' : 'offline'}`}
                                                        />
                                                        <div className="online-info">
                                                            <div className="online-name">
                                                                {f.username}
                                                            </div>
                                                            <div className="online-rating">
                                                                рейтинг {f.rating}
                                                                {f.online ? '' : ' · не в сети'}
                                                            </div>
                                                        </div>
                                                        <button
                                                            className="btn-online-challenge"
                                                            disabled={!f.online || !!pending}
                                                            onClick={() => onChallenge(f.username)}
                                                            title={
                                                                !f.online
                                                                    ? 'Игрок не в сети'
                                                                    : pending
                                                                        ? 'Ждём ответа'
                                                                        : 'Вызвать на игру'
                                                            }
                                                        >
                                                            {pending ? 'ждём' : 'вызвать'}
                                                        </button>
                                                    </div>
                                                    <button
                                                        className="btn-friend-toggle is-friend"
                                                        onClick={() => onRemoveFriend(f.username)}
                                                        title="Убрать из друзей"
                                                    >
                                                        ✕ убрать
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        )}

                        {activeTab === 'rating' && (
                            <div className="leaderboard-section">
                                <div className="online-header">Таблица лидеров</div>

                                {leaderboard.length === 0 ? (
                                    <p className="side-hint">
                                        Пока никто не играл. Рейтинг начисляется по итогам матча.
                                    </p>
                                ) : (
                                    <ol className="leaderboard">
                                        {leaderboard.map((e, i) => (
                                            <li
                                                key={e.username}
                                                className={`leaderboard-row ${e.username === username ? 'me' : ''}`}
                                            >
                                                <span className="place">{i + 1}</span>
                                                <span className="who">
                                                    {e.username}
                                                    {e.username === username && ' (вы)'}
                                                </span>
                                                <span className="record">
                                                    {e.wins}П {e.losses}П {e.draws}Н
                                                </span>
                                                <span className="points">{e.rating}</span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
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
