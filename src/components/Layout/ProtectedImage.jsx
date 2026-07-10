import { useProtectedMedia } from '../../hooks/useProtectedMedia';

// <img> can't send our auth headers, so protected files (chat attachments,
// marketing photos) are fetched as a blob via axios and rendered from an
// object URL instead of pointing straight at the API path.
const ProtectedImage = ({ apiPath, alt, className, style, onClick }) => {
  const { url } = useProtectedMedia(apiPath);

  if (!url) {
    return <div className={className} style={{ ...style, background: '#f1f5f9' }} aria-busy="true" />;
  }

  return <img src={url} alt={alt} className={className} style={style} onClick={onClick} />;
};

export default ProtectedImage;
