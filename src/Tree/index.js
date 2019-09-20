import React from 'react';
import { polyfill } from 'react-lifecycles-compat';
import T from 'prop-types';
import { layout, select, behavior, event } from 'd3';
import clone from 'clone';
import deepEqual from 'deep-equal';
import uuid from 'uuid';

import NodeWrapper from './NodeWrapper';
import Node from '../Node';
import Link from '../Link';
import './style.css';

class Tree extends React.Component {
  state = {
    // eslint-disable-next-line react/no-unused-state
    dataRef: this.props.data,
    data: Tree.assignInternalProperties(clone(this.props.data)),
    d3: Tree.calculateD3Geometry(this.props),
    rd3tSvgClassName: `_${uuid.v4()}`,
    rd3tGClassName: `_${uuid.v4()}`,
  };

  internalState = {
    initialRender: true,
    targetNode: null,
    isTransitioning: false,
  };

  static getDerivedStateFromProps(nextProps, prevState) {
    let derivedState = null;

    // Clone new data & assign internal properties if `data` object reference changed.
    if (nextProps.data !== prevState.dataRef) {
      derivedState = {
        // eslint-disable-next-line react/no-unused-state
        dataRef: nextProps.data,
        data: Tree.assignInternalProperties(clone(nextProps.data)),
      };
    }

    const d3 = Tree.calculateD3Geometry(nextProps);
    if (!deepEqual(d3, prevState.d3)) {
      derivedState = derivedState || {};
      derivedState.d3 = d3;
    }

    return derivedState;
  }

  componentDidMount() {
    this.bindZoomListener(this.props);
    this.internalState.initialRender = false;
  }

  componentDidUpdate(prevProps) {
    // If zoom-specific props change -> rebind listener with new values
    // Or: rebind zoom listeners to new DOM nodes in case NodeWrapper switched <TransitionGroup> <-> <g>
    if (
      !deepEqual(this.props.translate, prevProps.translate) ||
      !deepEqual(this.props.scaleExtent, prevProps.scaleExtent) ||
      this.props.zoom !== prevProps.zoom ||
      this.props.transitionDuration !== prevProps.transitionDuration
    ) {
      this.bindZoomListener(this.props);
    }

    if (typeof this.props.onUpdate === 'function') {
      this.props.onUpdate({
        node: this.internalState.targetNode ? clone(this.internalState.targetNode) : null,
        zoom: this.state.d3.scale,
        translate: this.state.d3.translate,
      });
    }
    // Reset the last target node after we've flushed it to `onUpdate`.
    this.internalState.targetNode = null;
  }

  /**
   * setInitialTreeDepth - Description
   *
   * @param {array} nodeSet Array of nodes generated by `generateTree`
   * @param {number} initialDepth Maximum initial depth the tree should render
   *
   * @return {void}
   */
  setInitialTreeDepth(nodeSet, initialDepth) {
    nodeSet.forEach(n => {
      n._collapsed = n.depth >= initialDepth;
    });
  }

  /**
   * bindZoomListener - If `props.zoomable`, binds a listener for
   * "zoom" events to the SVG and sets scaleExtent to min/max
   * specified in `props.scaleExtent`.
   *
   * @return {void}
   */
  bindZoomListener(props) {
    const { zoomable, scaleExtent, translate, zoom, onUpdate } = props;
    const { rd3tSvgClassName, rd3tGClassName } = this.state;
    const svg = select(`.${rd3tSvgClassName}`);
    const g = select(`.${rd3tGClassName}`);

    if (zoomable) {
      svg.call(
        behavior
          .zoom()
          .scaleExtent([scaleExtent.min, scaleExtent.max])
          .on('zoom', () => {
            g.attr('transform', `translate(${event.translate}) scale(${event.scale})`);
            if (typeof onUpdate === 'function') {
              // This callback is magically called not only on "zoom", but on "drag", as well,
              // even though event.type == "zoom".
              // Taking advantage of this and not writing a "drag" handler.
              onUpdate({
                node: null,
                zoom: event.scale,
                translate: { x: event.translate[0], y: event.translate[1] },
              });
              this.state.d3.scale = event.scale;
              this.state.d3.translate = { x: event.translate[0], y: event.translate[1] };
            }
          })
          // Offset so that first pan and zoom does not jump back to [0,0] coords
          .scale(zoom)
          .translate([translate.x, translate.y]),
      );
    }
  }

  /**
   * assignInternalProperties - Assigns internal properties to each node in the
   * `data` set that are required for tree manipulation and returns
   * a new `data` array.
   *
   * @static
   * @param {array} data Hierarchical tree data
   *
   * @return {array} `data` array with internal properties added
   */
  static assignInternalProperties(data) {
    // Wrap the root node into an array for recursive transformations if it wasn't in one already.
    const d = Array.isArray(data) ? data : [data];
    return d.map(node => {
      node.id = uuid.v4();
      // If the node's `_collapsed` state wasn't defined by the data set -> default to `false`.
      if (node._collapsed === undefined) {
        node._collapsed = false;
      }
      // If there are children, recursively assign properties to them too
      if (node.children && node.children.length > 0) {
        node.children = Tree.assignInternalProperties(node.children);
        node._children = node.children;
      }
      return node;
    });
  }

  /**
   * findNodesById - Recursively walks the nested `nodeSet` until a node matching `nodeId` is found.
   *
   * @param {string} nodeId The `node.id` being searched for
   * @param {array} nodeSet Array of nested `node` objects
   * @param {array} hits Accumulator for matches, passed between recursive calls
   *
   * @return {array} Set of nodes matching `nodeId`
   */
  // TODO: Refactor this into a more readable/reasonable recursive depth-first walk.
  findNodesById(nodeId, nodeSet, hits) {
    if (hits.length > 0) {
      return hits;
    }

    hits = hits.concat(nodeSet.filter(node => node.id === nodeId));

    nodeSet.forEach(node => {
      if (node._children && node._children.length > 0) {
        hits = this.findNodesById(nodeId, node._children, hits);
      }
    });

    return hits;
  }

  /**
   * findNodesAtDepth - Recursively walks the nested `nodeSet` until all nodes at `depth` have been found.
   *
   * @param {number} depth Target depth for which nodes should be returned
   * @param {array} nodeSet Array of nested `node` objects
   * @param {array} accumulator Accumulator for matches, passed between recursive calls
   * @return
   */
  findNodesAtDepth(depth, nodeSet, accumulator) {
    accumulator = accumulator.concat(nodeSet.filter(node => node.depth === depth));

    nodeSet.forEach(node => {
      if (node._children && node._children.length > 0) {
        accumulator = this.findNodesAtDepth(depth, node._children, accumulator);
      }
    });

    return accumulator;
  }

  /**
   * collapseNode - Recursively sets the `_collapsed` property of
   * the passed `node` object and its children to `true`.
   *
   * @param {Node} node Node object with custom properties
   *
   * @return {void}
   */
  static collapseNode(node) {
    node._collapsed = true;
    if (node._children && node._children.length > 0) {
      node._children.forEach(child => {
        Tree.collapseNode(child);
      });
    }
  }

  /**
   * expandNode - Sets the `_collapsed` property of
   * the passed `node` object to `false`.
   *
   * @param {object} node Node object with custom properties
   *
   * @return {void}
   */
  static expandNode(node) {
    node._collapsed = false;
  }

  /**
   * collapseNodeNeighbors - Collapses all nodes in `nodeSet` that are neighbors (same depth) of `targetNode`.
   *
   * @param {object} targetNode
   * @param {array} nodeSet
   *
   * @return {void}
   */
  collapseNeighborNodes(targetNode, nodeSet) {
    const neighbors = this.findNodesAtDepth(targetNode.depth, nodeSet, []).filter(
      node => node.id !== targetNode.id,
    );
    neighbors.forEach(neighbor => Tree.collapseNode(neighbor));
  }

  /**
   * handleNodeToggle - Finds the node matching `nodeId` and
   * expands/collapses it, depending on the current state of
   * its `_collapsed` property.
   * `setState` callback receives targetNode and handles
   * `props.onClick` if defined.
   *
   * @param {string} nodeId A node object's `id` field.
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleNodeToggle = (nodeId, evt) => {
    const data = clone(this.state.data);
    const matches = this.findNodesById(nodeId, data, []);
    const targetNode = matches[0];
    // Persist the SyntheticEvent for downstream handling by users.
    evt.persist();

    if (this.props.collapsible && !this.state.isTransitioning) {
      if (targetNode._collapsed) {
        Tree.expandNode(targetNode);
        this.props.shouldCollapseNeighborNodes && this.collapseNeighborNodes(targetNode, data);
      } else {
        Tree.collapseNode(targetNode);
      }
      // Lock node toggling while transition takes place
      this.setState({ data, isTransitioning: true }, () => this.handleOnClickCb(targetNode, evt));
      // Await transitionDuration + 10 ms before unlocking node toggling again
      setTimeout(
        () => this.setState({ isTransitioning: false }),
        this.props.transitionDuration + 10,
      );
      this.internalState.targetNode = targetNode;
    } else {
      this.handleOnClickCb(targetNode, evt);
    }
  };

  /**
   * handleOnClickCb - Handles the user-defined `onClick` function
   *
   * @param {object} targetNode Description
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnClickCb = (targetNode, evt) => {
    const { onClick } = this.props;
    if (onClick && typeof onClick === 'function') {
      onClick(clone(targetNode), evt);
    }
  };

  /**
   * handleOnLinkClickCb - Handles the user-defined `onLinkClick` function
   *
   * @param {object} linkSource Description
   *
   * @param {object} linkTarget Description
   *
   *  @param {object} evt Event
   *
   * @return {void}
   */
  handleOnLinkClickCb = (linkSource, linkTarget, evt) => {
    const { onLinkClick } = this.props;
    if (onLinkClick && typeof onLinkClick === 'function') {
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onLinkClick(clone(linkSource), clone(linkTarget), evt);
    }
  };

  /**
   * handleOnMouseOverCb - Handles the user-defined `onMouseOver` function
   *
   * @param {string} nodeId
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnMouseOverCb = (nodeId, evt) => {
    const { onMouseOver } = this.props;
    if (onMouseOver && typeof onMouseOver === 'function') {
      const data = clone(this.state.data);
      const matches = this.findNodesById(nodeId, data, []);
      const targetNode = matches[0];
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onMouseOver(clone(targetNode), evt);
    }
  };

  /**
   * handleOnLinkMouseOverCb - Handles the user-defined `onLinkMouseOver` function
   *
   * @param {object} linkSource Description
   *
   * @param {object} linkTarget Description
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnLinkMouseOverCb = (linkSource, linkTarget, evt) => {
    const { onLinkMouseOver } = this.props;
    if (onLinkMouseOver && typeof onLinkMouseOver === 'function') {
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onLinkMouseOver(clone(linkSource), clone(linkTarget), evt);
    }
  };

  /**
   * handleOnMouseOutCb - Handles the user-defined `onMouseOut` function
   *
   * @param {string} nodeId
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnMouseOutCb = (nodeId, evt) => {
    const { onMouseOut } = this.props;
    if (onMouseOut && typeof onMouseOut === 'function') {
      const data = clone(this.state.data);
      const matches = this.findNodesById(nodeId, data, []);
      const targetNode = matches[0];
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onMouseOut(clone(targetNode), evt);
    }
  };

  /**
   * handleOnLinkMouseOutCb - Handles the user-defined `onLinkMouseOut` function
   *
   * @param {string} linkSource
   *
   * @param {string} linkTarget
   *
   * @param {object} evt Event
   *
   * @return {void}
   */
  handleOnLinkMouseOutCb = (linkSource, linkTarget, evt) => {
    const { onLinkMouseOut } = this.props;
    if (onLinkMouseOut && typeof onLinkMouseOut === 'function') {
      // Persist the SyntheticEvent for downstream handling by users.
      evt.persist();
      onLinkMouseOut(clone(linkSource), clone(linkTarget), evt);
    }
  };

  /**
   * generateTree - Generates tree elements (`nodes` and `links`) by
   * grabbing the rootNode from `this.state.data[0]`.
   * Restricts tree depth to `props.initialDepth` if defined and if this is
   * the initial render of the tree.
   *
   * @return {object} Object containing `nodes` and `links`.
   */
  generateTree() {
    const {
      initialDepth,
      useCollapseData,
      depthFactor,
      separation,
      nodeSize,
      orientation,
    } = this.props;

    const tree = layout
      .tree()
      .nodeSize(orientation === 'horizontal' ? [nodeSize.y, nodeSize.x] : [nodeSize.x, nodeSize.y])
      .separation(
        (a, b) => (a.parent.id === b.parent.id ? separation.siblings : separation.nonSiblings),
      )
      .children(d => (d._collapsed ? null : d._children));

    const rootNode = this.state.data[0];
    let nodes = tree.nodes(rootNode);

    // set `initialDepth` on first render if specified
    if (
      useCollapseData === false &&
      initialDepth !== undefined &&
      this.internalState.initialRender
    ) {
      this.setInitialTreeDepth(nodes, initialDepth);
      nodes = tree.nodes(rootNode);
    }

    if (depthFactor) {
      nodes.forEach(node => {
        node.y = node.depth * depthFactor;
      });
    }

    const links = tree.links(nodes);
    return { nodes, links };
  }

  /**
   * calculateD3Geometry - Set initial zoom and position.
   * Also limit zoom level according to `scaleExtent` on initial display. This is necessary,
   * because the first time we are setting it as an SVG property, instead of going
   * through D3's scaling mechanism, which would have picked up both properties.
   *
   * @param  {object} nextProps
   * @return {object} {translate: {x: number, y: number}, zoom: number}
   */
  static calculateD3Geometry(nextProps) {
    let scale;

    if (nextProps.zoom > nextProps.scaleExtent.max) {
      scale = nextProps.scaleExtent.max;
    } else if (nextProps.zoom < nextProps.scaleExtent.min) {
      scale = nextProps.scaleExtent.min;
    } else {
      scale = nextProps.zoom;
    }

    return {
      translate: nextProps.translate,
      scale,
    };
  }

  render() {
    const { nodes, links } = this.generateTree();
    const { rd3tSvgClassName, rd3tGClassName } = this.state;
    const {
      nodeSvgShape,
      nodeLabelComponent,
      orientation,
      pathFunc,
      transitionDuration,
      zoomable,
      textLayout,
      nodeSize,
      depthFactor,
      initialDepth,
      separation,
      circleRadius,
      allowForeignObjects,
      styles,
    } = this.props;
    const { translate, scale } = this.state.d3;
    const subscriptions = { ...nodeSize, ...separation, depthFactor, initialDepth };
    return (
      <div className={`rd3t-tree-container ${zoomable ? 'rd3t-grabbable' : undefined}`}>
        <svg className={rd3tSvgClassName} width="100%" height="100%">
          <NodeWrapper
            transitionDuration={transitionDuration}
            component="g"
            className={rd3tGClassName}
            transform={`translate(${translate.x},${translate.y}) scale(${scale})`}
          >
            {links.map(linkData => (
              <Link
                key={uuid.v4()}
                orientation={orientation}
                pathFunc={pathFunc}
                linkData={linkData}
                onClick={this.handleOnLinkClickCb}
                onMouseOver={this.handleOnLinkMouseOverCb}
                onMouseOut={this.handleOnLinkMouseOutCb}
                transitionDuration={transitionDuration}
                styles={styles.links}
              />
            ))}

            {nodes.map(nodeData => (
              <Node
                key={nodeData.id}
                nodeSvgShape={{ ...nodeSvgShape, ...nodeData.nodeSvgShape }}
                nodeLabelComponent={nodeLabelComponent}
                nodeSize={nodeSize}
                orientation={orientation}
                transitionDuration={transitionDuration}
                nodeData={nodeData}
                name={nodeData.name}
                attributes={nodeData.attributes}
                onClick={this.handleNodeToggle}
                onMouseOver={this.handleOnMouseOverCb}
                onMouseOut={this.handleOnMouseOutCb}
                textLayout={nodeData.textLayout || textLayout}
                circleRadius={circleRadius}
                subscriptions={subscriptions}
                allowForeignObjects={allowForeignObjects}
                styles={styles.nodes}
              />
            ))}
          </NodeWrapper>
        </svg>
      </div>
    );
  }
}

Tree.defaultProps = {
  nodeSvgShape: {
    shape: 'circle',
    shapeProps: {
      r: 10,
    },
  },
  nodeLabelComponent: null,
  onClick: undefined,
  onMouseOver: undefined,
  onMouseOut: undefined,
  onLinkClick: undefined,
  onLinkMouseOver: undefined,
  onLinkMouseOut: undefined,
  onUpdate: undefined,
  orientation: 'horizontal',
  translate: { x: 0, y: 0 },
  pathFunc: 'diagonal',
  transitionDuration: 500,
  depthFactor: undefined,
  collapsible: true,
  useCollapseData: false,
  initialDepth: undefined,
  zoomable: true,
  zoom: 1,
  scaleExtent: { min: 0.1, max: 1 },
  nodeSize: { x: 140, y: 140 },
  separation: { siblings: 1, nonSiblings: 2 },
  textLayout: {
    textAnchor: 'start',
    x: 10,
    y: -10,
    transform: undefined,
  },
  allowForeignObjects: false,
  shouldCollapseNeighborNodes: false,
  circleRadius: undefined, // TODO: DEPRECATE
  styles: {},
};

Tree.propTypes = {
  data: T.oneOfType([T.array, T.object]).isRequired,
  nodeSvgShape: T.shape({
    shape: T.string,
    shapeProps: T.object,
  }),
  nodeLabelComponent: T.object,
  onClick: T.func,
  onMouseOver: T.func,
  onMouseOut: T.func,
  onLinkClick: T.func,
  onLinkMouseOver: T.func,
  onLinkMouseOut: T.func,
  onUpdate: T.func,
  orientation: T.oneOf(['horizontal', 'vertical']),
  translate: T.shape({
    x: T.number,
    y: T.number,
  }),
  pathFunc: T.oneOfType([T.oneOf(['diagonal', 'elbow', 'straight']), T.func]),
  transitionDuration: T.number,
  depthFactor: T.number,
  collapsible: T.bool,
  useCollapseData: T.bool,
  initialDepth: T.number,
  zoomable: T.bool,
  zoom: T.number,
  scaleExtent: T.shape({
    min: T.number,
    max: T.number,
  }),
  nodeSize: T.shape({
    x: T.number,
    y: T.number,
  }),
  separation: T.shape({
    siblings: T.number,
    nonSiblings: T.number,
  }),
  textLayout: T.object,
  allowForeignObjects: T.bool,
  shouldCollapseNeighborNodes: T.bool,
  circleRadius: T.number,
  styles: T.shape({
    nodes: T.object,
    links: T.object,
  }),
};

// Polyfill React 16 lifecycle methods for compat with React 15.
polyfill(Tree);

export default Tree;
