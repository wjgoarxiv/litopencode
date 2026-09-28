# Import a saved draw.io diagram

Accepted sources are draw.io XML, compressed diagram pages, saved multi-page files, and SVG or PNG files with embedded mxfile metadata. A screenshot or ordinary SVG export has no editable source model and is rejected.

Run the local Node extractor from the selected skill directory:

~~~sh
node scripts/drawio-extract.mjs path/to/source.drawio [--page 0]
~~~

The result is a JSON description of one page. The parser checks the page index, XML depth, byte and decoded size, PNG chunk CRC, cell counts, geometry values, and duplicate ids. It does not launch draw.io or load external resources. DTDs, entity declarations, active elements, and event attributes are rejected. Links, styling, images, and coordinates are discarded; node and connector labels remain inert text.

Review the labels, parent groups, and relationships before redrawing. Choose a type guide and compose a new layout. Record combined or omitted meaning and ask about empty shapes whose purpose cannot be recovered.
