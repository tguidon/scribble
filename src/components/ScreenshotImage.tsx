import { useImageSource } from "../useImageSource";

export function ScreenshotImage({
  id,
  alt,
  retryable = true,
}: {
  id: string;
  alt: string;
  retryable?: boolean;
}) {
  const source = useImageSource(id);
  return (
    <>
      <img src={source.url} alt={alt} />
      {source.error && retryable && (
        <span className="image-load-error" role="alert">
          {source.error} <button onClick={source.retry}>Retry image</button>
        </span>
      )}
    </>
  );
}
