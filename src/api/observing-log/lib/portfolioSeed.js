'use strict';

/**
 * One-off links from scheduler project names to the portfolio entries they
 * produced, applied only when the rebuild *creates* a project row (the first
 * boot after the imaging-project type is deployed). Rows that already exist
 * are never touched, so anything changed in the admin afterwards stays put.
 *
 * Keys are project names exactly as the Target Scheduler sends them; values
 * are portfolio-entry slugs. A project listed here is also marked complete.
 */
module.exports = {
  'Bubble Nebula': ['bubble_nebula_a_deeper_look'],
  'Lobster Claw Nebula': ['the-lobster-claw-nebula-in-sho-with-rgb-stars'],
  M33: ['triangulum-galaxy-in-lrgb-with-ha-and-oiii'],
  'Horsehead Nebula': ['the-horsehead-nebula-closing-a-chapter'],
  'Christmas Tree Cluster': ['christmas-tree-cluster'],
  'Orions Nebula': ['the-great-orion-nebula'],
  M40: ['the-mistake-that-became-something-beautiful'],
  'Flaming Star Nebula': ['fire-and-ice-in-auriga'],
  'Iris Nebula': ['a-flower-made-of-dust-and-starlight'],
  'Markarian’s Chain': ['the-heart-of-the-virgo-cluster'],
  'Wizards Tower': ['a-cluster-carving-its-own-cavity'],
  'The Butterfly Nebula': ['a-butterfly-divided-by-dust'],
};
