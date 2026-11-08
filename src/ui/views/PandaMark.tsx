/** The static Panda from the shared brand folder. The URL is relative to the page, so it also loads from the packaged app (file://). */
export const PandaMark = ({ small = false }: { small?: boolean }) => (
  <img className={small ? 'panda-mark small' : 'panda-mark'} src={`${import.meta.env.BASE_URL}brand/panda-still.svg`} alt="" aria-hidden="true" />
);
