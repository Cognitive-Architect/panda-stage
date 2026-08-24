import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Field,
  IconButton,
  PanelSurface,
  SectionHeader,
  SegmentedTabs,
  Stepper,
} from '../../src/renderer/ui';

describe('UI-M1 reusable primitives', () => {
  it('keeps native button disabled/focus semantics and exposes variants', () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { disabled: true, variant: 'danger' }, 'Delete'),
    );

    expect(markup).toContain('data-ui-button="true"');
    expect(markup).toContain('data-ui-variant="danger"');
    expect(markup).toContain('disabled');
    expect(markup).toContain('type="button"');
  });

  it('requires an accessible name and renders an icon inside a 44px contract', () => {
    const markup = renderToStaticMarkup(
      createElement(IconButton, { 'aria-label': 'Open menu', icon: '⋮' }),
    );

    expect(markup).toContain('aria-label="Open menu"');
    expect(markup).toContain('data-ui-size="icon"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('rejects an icon button with an empty accessible name', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(IconButton, { 'aria-label': '', icon: '⋮' }),
      ),
    ).toThrow('non-empty aria-label');
  });

  it('renders a single-choice tablist with explicit selected and disabled state', () => {
    const markup = renderToStaticMarkup(
      createElement(SegmentedTabs, {
        'aria-label': 'Workspace',
        onChange: vi.fn(),
        options: [
          { value: 'edit', label: 'Edit' },
          { value: 'review', label: 'Review', disabled: true },
        ],
        value: 'edit',
      }),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('disabled');
  });

  it('associates field label/help/error content with its control', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Field,
        {
          children: createElement('input'),
          description: 'Use a short name',
          error: 'Name is required',
          label: 'Name',
        },
      ),
    );

    expect(markup).toContain('class="ui-field"');
    expect(markup).toContain('for="ui-field-');
    expect(markup).toContain('aria-describedby="ui-field-');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
  });

  it('keeps the stepper value exact between decrement and increment controls', () => {
    const markup = renderToStaticMarkup(
      createElement(Stepper, {
        'aria-label': 'Frames',
        decrementDisabled: true,
        incrementDisabled: false,
        onDecrement: vi.fn(),
        onIncrement: vi.fn(),
        value: '0007',
      }),
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('Decrease Frames');
    expect(markup).toContain('0007');
    expect(markup).toContain('Increase Frames');
  });

  it('provides semantic panel and section primitives', () => {
    const markup = renderToStaticMarkup(
      createElement(
        PanelSurface,
        null,
        createElement(SectionHeader, {
          actions: createElement(Button, null, 'Save'),
          title: 'Settings',
        }),
      ),
    );

    expect(markup).toContain('data-ui-panel-surface="true"');
    expect(markup).toContain('class="ui-section-header"');
    expect(markup).toContain('<h2');
  });
});
