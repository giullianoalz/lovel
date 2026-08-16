import { useProtectedMedia } from '../../hooks/useProtectedMedia';

// <img> can't send our auth headers, so protected files (chat attachments,
// marketing photos) are fetched as a blob via axios and rendered from an
// object URL instead of pointing straight at the API path.
const ProtectedImage = ({ apiPath, alt, className, style, onClick }) => {
  const { url, error } = useProtectedMedia(apiPath);

  // A file the server can no longer produce (its bytes are gone, or Drive lost
  // it) used to sit here as a grey box claiming to still be loading, forever.
  // Say so instead, so a missing photo reads as missing rather than as slow.
  if (error) {
    return (
      <div
        className={className}
        style={{
          ...style,
          background: '#f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '4px',
          fontSize: '10px',
          lineHeight: 1.3,
          color: '#94a3b8',
        }}
        title={alt ? `${alt} — unavailable` : 'This image is no longer available'}
      >
        Image unavailable
      </div>
    );
  }

  if (!url) {
    return <div className={className} style={{ ...style, background: '#f1f5f9' }} aria-busy="true" />;
  }

  return <img src={url} alt={alt} className={className} style={style} onClick={onClick} />;
};

export default ProtectedImage;
