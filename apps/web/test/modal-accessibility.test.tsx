// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Modal } from '../src/components/ui/modal.js';

function TestModalHarness({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div>
      <button data-testid="trigger-button" onClick={() => setIsOpen(true)}>
        Open Dialog
      </button>
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Edit Configuration"
        description="Modify your interview configuration settings."
      >
        <input data-testid="first-input" placeholder="First input" />
        <input data-testid="second-input" placeholder="Second input" />
        <button data-testid="save-button" onClick={() => setIsOpen(false)}>
          Save Changes
        </button>
      </Modal>
    </div>
  );
}

describe('F05: Modal Accessibility & Focus Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('maintains WAI-ARIA dialog attributes: role="dialog", aria-modal="true", aria-labelledby', async () => {
    render(<TestModalHarness defaultOpen={true} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title');

    const title = screen.getByText('Edit Configuration');
    expect(title.id).toBe('modal-title');
  });

  it('focus enters modal upon opening', async () => {
    render(<TestModalHarness defaultOpen={false} />);

    const trigger = screen.getByTestId('trigger-button');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();

    // Focus moves into the first focusable element (close button)
    await waitFor(() => {
      const closeBtn = screen.getByRole('button', { name: /close dialog/i });
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  it('Tab wraps from last focusable element back to first', async () => {
    render(<TestModalHarness defaultOpen={true} />);

    const closeBtn = screen.getByRole('button', { name: /close dialog/i });
    const saveBtn = screen.getByTestId('save-button');

    // Move focus to last element
    saveBtn.focus();
    expect(document.activeElement).toBe(saveBtn);

    // Press Tab on last element
    fireEvent.keyDown(window, { key: 'Tab' });

    // Focus must wrap to first element (close button)
    expect(document.activeElement).toBe(closeBtn);
  });

  it('Shift+Tab wraps from first focusable element back to last', async () => {
    render(<TestModalHarness defaultOpen={true} />);

    const closeBtn = screen.getByRole('button', { name: /close dialog/i });
    const saveBtn = screen.getByTestId('save-button');

    // Focus is on first element
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Press Shift + Tab on first element
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    // Focus must wrap to last element (save button)
    expect(document.activeElement).toBe(saveBtn);
  });

  it('Escape key closes modal and restores focus to invoking element', async () => {
    render(<TestModalHarness defaultOpen={false} />);

    const trigger = screen.getByTestId('trigger-button');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    // Modal is removed from DOM
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    // Focus must be restored to trigger button
    expect(document.activeElement).toBe(trigger);
  });

  it('closing via close button restores focus to invoking element', async () => {
    render(<TestModalHarness defaultOpen={false} />);

    const trigger = screen.getByTestId('trigger-button');
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();

    const closeBtn = screen.getByRole('button', { name: /close dialog/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(document.activeElement).toBe(trigger);
  });
});
