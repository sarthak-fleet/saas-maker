import type { APIRoute, GetStaticPaths } from 'astro';
import { markdownPath, PUBLIC_ROUTES } from '../data/publicRoutes';

const markdownRoutes = PUBLIC_ROUTES.filter((route) => route.path !== '/');

export const getStaticPaths = (() =>
  markdownRoutes.map((route) => ({
    params: { path: markdownPath(route) },
    props: { body: route.markdown },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ body: string }> = ({ props }) =>
  new Response(props.body.endsWith('\n') ? props.body : `${props.body}\n`, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
