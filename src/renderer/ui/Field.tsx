import {
  cloneElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface FieldProps {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactElement;
  className?: string;
}

/** Labelled control wrapper with help and error relationships. */
export function Field({
  label,
  description,
  error,
  children,
  className,
}: FieldProps): React.JSX.Element {
  const generatedId = `ui-field-${useId().replaceAll(':', '')}`;
  const controlElement = children as ReactElement<Record<string, unknown>>;
  const childProps = controlElement.props as {
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean | 'false' | 'true';
  };
  const controlId = childProps.id ?? generatedId;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [
    childProps['aria-describedby'],
    descriptionId,
    errorId,
  ]
    .filter(Boolean)
    .join(' ');
  const classes = ['ui-field', className].filter(Boolean).join(' ');

  const control = cloneElement(controlElement, {
    id: controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': error ? true : childProps['aria-invalid'],
  });

  return (
    <div className={classes} data-ui-invalid={error ? 'true' : 'false'}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      {description ? (
        <div className="ui-field__description" id={descriptionId}>
          {description}
        </div>
      ) : null}
      {control}
      {error ? (
        <div className="ui-field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
