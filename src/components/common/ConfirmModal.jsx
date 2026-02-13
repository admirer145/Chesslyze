import React from 'react';
import { X } from 'lucide-react';

export const ConfirmModal = ({
    open,
    title,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
    meta,
    inputLabel,
    inputPlaceholder,
    inputValue,
    onInputChange,
    confirmDisabled = false,
    cancelDisabled = false,
    confirmClassName = 'btn-primary',
    error
}) => {
    if (!open) return null;

    const handleCancel = () => {
        if (cancelDisabled) return;
        onCancel?.();
    };

    return (
        <div className="confirm-modal" role="dialog" aria-modal="true">
            <div className="confirm-modal__backdrop" onClick={handleCancel} />
            <div className="confirm-modal__panel">
                <div className="confirm-modal__header">
                    <div>
                        <div className="confirm-modal__title">{title}</div>
                        {description && <div className="confirm-modal__desc">{description}</div>}
                    </div>
                    <button
                        className="confirm-modal__close"
                        onClick={handleCancel}
                        aria-label="Close"
                        disabled={cancelDisabled}
                        type="button"
                    >
                        <X size={16} />
                    </button>
                </div>
                {meta && <div className="confirm-modal__meta">{meta}</div>}
                {inputLabel && (
                    <div className="confirm-modal__input">
                        <label>{inputLabel}</label>
                        <input
                            className="input"
                            value={inputValue ?? ''}
                            onChange={(e) => onInputChange?.(e.target.value)}
                            placeholder={inputPlaceholder}
                            autoFocus
                            aria-label={inputLabel}
                        />
                    </div>
                )}
                {error && <div className="confirm-modal__error">{error}</div>}
                <div className="confirm-modal__actions">
                    <button className="btn-secondary" onClick={handleCancel} disabled={cancelDisabled} type="button">
                        {cancelText}
                    </button>
                    <button className={confirmClassName} onClick={onConfirm} disabled={confirmDisabled} type="button">
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
