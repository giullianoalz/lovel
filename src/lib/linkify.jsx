import React from 'react';

/**
 * Turns the URLs and email addresses inside a plain-text block into real links.
 *
 * Announcement bodies are stored and rendered as plain text, so a post saying
 * "sign up at https://…" gave families something to retype by hand. This is
 * deliberately not a markdown or HTML renderer: the text still comes out
 * escaped by React, and only the runs that match a link become anchors — an
 * admin can't post markup, accidentally or otherwise.
 *
 * Matches http(s):// URLs, bare www. hosts, and mailto-able addresses.
 */
const LINK_PATTERN = /((?:https?:\/\/|www\.)[^\s<>()[\]{}"']+|[^\s<>()[\]{}"']+@[^\s<>()[\]{}"',;:]+\.[a-z]{2,})/gi;

// Trailing punctuation almost always belongs to the sentence, not the link:
// "see https://site.com/page." should not resolve to a URL ending in a period.
const TRAILING_PUNCTUATION = /[.,;:!?'"’”)\]}]+$/;

const splitTrailing = (token) => {
  const match = token.match(TRAILING_PUNCTUATION);
  if (!match) return [token, ''];
  return [token.slice(0, token.length - match[0].length), match[0]];
};

const hrefFor = (token) => {
  if (/^https?:\/\//i.test(token)) return token;
  if (/^www\./i.test(token)) return `https://${token}`;
  return `mailto:${token}`;
};

export const Linkified = ({ text, className }) => {
  if (!text) return null;

  const parts = String(text).split(LINK_PATTERN);

  return (
    <>
      {parts.map((part, i) => {
        // split() with one capture group puts the matches at the odd indexes.
        if (i % 2 === 0) return part ? <React.Fragment key={i}>{part}</React.Fragment> : null;

        const [link, tail] = splitTrailing(part);
        if (!link) return <React.Fragment key={i}>{part}</React.Fragment>;

        return (
          <React.Fragment key={i}>
            <a
              className={className || 'inline-link'}
              href={hrefFor(link)}
              target="_blank"
              // noreferrer as well as noopener: the destination has no business
              // learning which page of the academy's app sent someone.
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {link}
            </a>
            {tail}
          </React.Fragment>
        );
      })}
    </>
  );
};

export default Linkified;
