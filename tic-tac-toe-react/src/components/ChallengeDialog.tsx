import React, { useEffect } from 'react';
import './ChallengeDialog.css';

interface ChallengeDialogProps {
    /** входящий вызов на игру */
    challenge: { challengeId: string; from: string } | null;
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
 * Модальные окна для входящих вызовов и уведомления. Отдельный компонент,
 * чтобы App не раздувался условиями: одновременно показывается только одно.
 */
const ChallengeDialog: React.FC<ChallengeDialogProps> = ({
    challenge,
    rematch,
    notice,
    onRespondChallenge,
    onRespondRematch,
    onDismissNotice
}) => {
    // Уведомление прячется само, но клик тоже закрывает
    useEffect(() => {
        if (!notice) return;
        const t = setTimeout(onDismissNotice, AUTO_HIDE_MS);
        return () => clearTimeout(t);
    }, [notice, onDismissNotice]);

    if (challenge) {
        return (
            <div className="dialog-overlay">
                <div className="dialog">
                    <div className="dialog-title">Вызов на игру</div>
                    <div className="dialog-text">
                        <b>{challenge.from}</b> вызывает вас на матч
                    </div>
                    <div className="dialog-actions">
                        <button
                            className="btn"
                            onClick={() => onRespondChallenge(true)}
                        >
                            Принять
                        </button>
                        <button
                            className="btn btn-ghost"
                            onClick={() => onRespondChallenge(false)}
                        >
                            Отклонить
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (rematch) {
        return (
            <div className="dialog-overlay">
                <div className="dialog">
                    <div className="dialog-title">Реванш</div>
                    <div className="dialog-text">
                        <b>{rematch.from}</b> предлагает сыграть ещё раз
                    </div>
                    <div className="dialog-actions">
                        <button className="btn" onClick={() => onRespondRematch(true)}>
                            Сыграем
                        </button>
                        <button
                            className="btn btn-ghost"
                            onClick={() => onRespondRematch(false)}
                        >
                            Нет
                        </button>
                    </div>
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
