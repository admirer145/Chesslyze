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
    meta
}) => {
    if (!open) return null;

    return (
        <div className="confirm-modal" role="dialog" aria-modal="true">
            <div className="confirm-modal__backdrop" onClick={onCancel} />
            <div className="confirm-modal__panel">
                <div className="confirm-modal__header">
                    <div>
                        <div className="confirm-modal__title">{title}</div>
                        {description && <div className="confirm-modal__desc">{description}</div>}
                    </div>
                    <button className="confirm-modal__close" onClick={onCancel} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>
                {meta && <div className="confirm-modal__meta">{meta}</div>}
                <div className="confirm-modal__actions">
                    <button className="btn-secondary" onClick={onCancel}>{cancelText}</button>
                    <button className="btn-primary" onClick={onConfirm}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
};
