import React, { useEffect, useState } from 'react';
import './ChallengeDialog.css';

interface ChallengeDialogProps {
    /** входящий вызов на игру */
    challenge: { challengeId: string; from: string; expiresIn?: number } | null;
    /** входящее предложение реванша */
    rematch: { from: string } | null;
    /** короткое уведомление: отказ, ошибка */
    notice: string | null;
    onRespondChallenge: (accept: boolean) => void;
    onRespondRematch: (accept: boolean) => void;
    onDismissNotice: () => void;
}

const AUTO_HIDE_MS = 6000;

/**
 * Всплывающие окна для входящих вызовов и уведомления. Отдельный компонент,
 * чтобы App не раздувался условиями: одновременно показывается только одно.
 *
 * Вызов намеренно НЕ модальный: он приходит случайному игроку, и тот может
 * в этот момент вести партию с ботом. Перекрытие экрана остановило бы игру и
 * выглядело бы как зависание, поэтому это карточка в углу с отсчётом.
 */
const ChallengeDialog: React.FC<ChallengeDialogProps> = ({
    challenge,
    rematch,
    notice,
    onRespondChallenge,
    onRespondRematch,
    onDismissNotice
}) => {
    const [left, setLeft] = useState<number | null>(null);

    // Отсчёт окна ответа. Сервер всё равно закроет вызов сам - этот счётчик
    // только чтобы игрок видел, сколько осталось, и не ждал напрасно.
    useEffect(() => {
        if (!challenge) {
            setLeft(null);
            return;
        }
        const total = (challenge.expiresIn ?? 10000) / 1000;
        const started = Date.now();
        setLeft(Math.ceil(total));
        const t = setInterval(() => {
            const rest = Math.ceil(total - (Date.now() - started) / 1000);
            setLeft(rest > 0 ? rest : 0);
        }, 250);
        return () => clearInterval(t);
    }, [challenge]);

    // Уведомление прячется само, но клик тоже закрывает
    useEffect(() => {
        if (!notice) return;
        const t = setTimeout(onDismissNotice, AUTO_HIDE_MS);
        return () => clearTimeout(t);
    }, [notice, onDismissNotice]);

    if (challenge) {
        return (
            <div className="challenge-card">
                <div className="challenge-head">
                    <span className="challenge-title">Вызов на игру</span>
                    {left !== null && left > 0 && (
                        <span className="challenge-timer">{left} с</span>
                    )}
                </div>
                <div className="challenge-text">
                    <b>{challenge.from}</b> предлагает сыграть на рейтинг
                </div>
                <div className="challenge-actions">
                    <button className="btn btn-small" onClick={() => onRespondChallenge(true)}>
                        Принять
                    </button>
                    <button
                        className="btn btn-small btn-ghost"
                        onClick={() => onRespondChallenge(false)}
                    >
                        Отклонить
                    </button>
                </div>
            </div>
        );
    }

    if (rematch) {
        return (
            <div className="challenge-card">
                <div className="challenge-head">
                    <span className="challenge-title">Реванш</span>
                </div>
                <div className="challenge-text">
                    <b>{rematch.from}</b> предлагает сыграть ещё раз
                </div>
                <div className="challenge-actions">
                    <button className="btn btn-small" onClick={() => onRespondRematch(true)}>
                        Сыграем
                    </button>
                    <button
                        className="btn btn-small btn-ghost"
                        onClick={() => onRespondRematch(false)}
                    >
                        Нет
                    </button>
                </div>
            </div>
        );
    }

    if (notice) {
        return (
            <div className="dialog-toast" onClick={onDismissNotice}>
                {notice}
            </div>
        );
    }

    return null;
};

export default ChallengeDialog;
