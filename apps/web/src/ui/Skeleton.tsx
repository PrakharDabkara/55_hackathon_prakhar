interface Props {
  height?: string;
  width?: string;
  radius?: string;
}

/** A grey block where content will be. Never a spinner over content. */
export function Skeleton({ height = '1em', width = '100%', radius }: Props) {
  return (
    <div
      aria-hidden="true"
      className="sh-skeleton"
      style={{ height, width, ...(radius && { borderRadius: radius }) }}
    />
  );
}
